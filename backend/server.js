import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { getModelMetadata, predictDiagnosis } from '../ML/diagnosisModel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const port = process.env.PORT || 4000;
const mongoUri = process.env.MONGODB_URI;
const jwtSecret = process.env.JWT_SECRET || 'telemed_kiosk_secret';
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const groqApiKey = process.env.GROQ_API_KEY;
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let mongoReady = false;

function getListeningPidsWindows(portNumber) {
  const output = execSync(`netstat -ano -p tcp | findstr :${portNumber}`, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  const pids = new Set();
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (!line.includes('LISTENING')) {
      continue;
    }

    const parts = line.split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && /^\d+$/.test(pid)) {
      pids.add(pid);
    }
  }

  return [...pids];
}

function getListeningPidsUnix(portNumber) {
  const output = execSync(`lsof -ti tcp:${portNumber} -sTCP:LISTEN || true`, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line));
}

function freePortIfNeeded(portNumber) {
  const autoFreeEnabled = process.env.AUTO_FREE_PORT !== 'false';
  if (!autoFreeEnabled) {
    return;
  }

  try {
    const pids = process.platform === 'win32'
      ? getListeningPidsWindows(portNumber)
      : getListeningPidsUnix(portNumber);

    for (const pid of pids) {
      if (Number(pid) === process.pid) {
        continue;
      }

      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        } else {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        }
        console.log(`[port-guard] Stopped PID ${pid} on port ${portNumber}.`);
      } catch (error) {
        console.warn(`[port-guard] Could not stop PID ${pid}: ${error.message}`);
      }
    }
  } catch {
    // No active listener found on the requested port.
  }
}

app.use(cors({ origin: clientOrigin }));
app.use(express.json());

if (!mongoUri) {
  throw new Error('MONGODB_URI is required');
}

mongoose.connection.on('connected', () => {
  mongoReady = true;
  console.log('MongoDB connected');
});

mongoose.connection.on('disconnected', () => {
  mongoReady = false;
  console.log('MongoDB disconnected');
});

mongoose.connection.on('error', (error) => {
  mongoReady = false;
  console.error('MongoDB error:', error);
});

mongoose.connect(mongoUri, {
  serverSelectionTimeoutMS: 10000,
}).catch((error) => {
  console.error('Initial MongoDB connection failed:', error);
});

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    phone: { type: String, default: '' },
    village: { type: String, default: '' },
    district: { type: String, default: '' },
    role: { type: String, enum: ['patient', 'doctor', 'asha_worker', 'admin'], default: 'patient' },
    state: { type: String, default: 'India' },
    supabaseUserId: { type: String, default: '' },
    supabaseProfileId: { type: String, default: '' },
  },
  { timestamps: true }
);

const User = mongoose.model('User', userSchema);

const patientSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    dob: { type: String, default: '' },
    gender: { type: String, enum: ['male', 'female', 'other', 'not_specified'], default: 'not_specified' },
    blood_group: { type: String, default: '' },
    aadhar_number: { type: String, default: '' },
    weight_kg: { type: Number, default: null },
    height_cm: { type: Number, default: null },
    medical_history: { type: String, default: '' },
    allergies: { type: String, default: '' },
    emergency_contact_name: { type: String, default: '' },
    emergency_contact_phone: { type: String, default: '' },
  },
  { timestamps: true }
);

const PatientModel = mongoose.model('Patient', patientSchema);

const hasSupabaseAdminConfig = Boolean(supabaseUrl && supabaseServiceRoleKey);

const supabaseAdminRequest = async (path, options = {}) => {
  if (!hasSupabaseAdminConfig) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  }

  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.msg || data?.message || `${response.status} ${response.statusText}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data;
};

const createOrGetSupabaseUser = async (user, password) => {
  if (user.supabaseUserId) {
    return user.supabaseUserId;
  }

  try {
    const created = await supabaseAdminRequest('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email: user.email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: user.fullName,
          phone: user.phone,
          village: user.village,
          district: user.district,
          role: user.role,
        },
      }),
    });

    return created.user.id;
  } catch (error) {
    if (error.status !== 422) {
      throw error;
    }

    const usersPage = await supabaseAdminRequest('/auth/v1/admin/users?page=1&per_page=1000', {
      method: 'GET',
    });

    const match = usersPage.users?.find((u) => String(u.email).toLowerCase() === String(user.email).toLowerCase());
    if (!match?.id) {
      throw new Error('Supabase user exists but could not be fetched');
    }

    return match.id;
  }
};

const upsertSupabaseProfile = async (supabaseUserId, user) => {
  const profileRows = await supabaseAdminRequest('/rest/v1/profiles?on_conflict=user_id', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify([
      {
        user_id: supabaseUserId,
        full_name: user.fullName,
        role: user.role,
        phone: user.phone || '',
        village: user.village || '',
        district: user.district || '',
        state: user.state || 'India',
      },
    ]),
  });

  if (!Array.isArray(profileRows) || !profileRows[0]?.id) {
    throw new Error('Failed to upsert Supabase profile');
  }

  return profileRows[0].id;
};

const ensureSupabaseIdentity = async (user, plainPassword) => {
  if (!hasSupabaseAdminConfig) {
    return;
  }

  let changed = false;
  if (!user.supabaseUserId) {
    user.supabaseUserId = await createOrGetSupabaseUser(user, plainPassword);
    changed = true;
  }

  if (!user.supabaseProfileId) {
    user.supabaseProfileId = await upsertSupabaseProfile(user.supabaseUserId, user);
    changed = true;
  }

  if (changed) {
    await user.save();
  }
};

const syncSupabaseIdentitySafely = async (user, plainPassword) => {
  try {
    await ensureSupabaseIdentity(user, plainPassword);
  } catch (error) {
    console.warn('Supabase sync skipped:', error.message);
  }
};

const toClientUser = (user, supabaseProfileId = null) => ({
  id: supabaseProfileId || user._id.toString(),
  user_id: user._id.toString(),
  full_name: user.fullName,
  role: user.role,
  phone: user.phone,
  village: user.village,
  district: user.district,
  state: user.state,
  created_at: user.createdAt instanceof Date ? user.createdAt.toISOString() : new Date(user.createdAt).toISOString(),
  updated_at: user.updatedAt instanceof Date ? user.updatedAt.toISOString() : new Date(user.updatedAt).toISOString(),
});

const getSupabaseJWT = async (supabaseUserId) => {
  try {
    const jwtData = await supabaseAdminRequest('/auth/v1/admin/users/' + supabaseUserId + '/jwt', {
      method: 'POST',
    });
    return jwtData?.jwt || null;
  } catch (error) {
    console.error('Failed to generate Supabase JWT:', error.message);
    return null;
  }
};

const signToken = (userId) => jwt.sign({ userId }, jwtSecret, { expiresIn: '7d' });

const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, jwtSecret);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const loadAuthUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    req.authUser = user;
    return next();
  } catch {
    return res.status(500).json({ message: 'Failed to load user context' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  const userRole = req.authUser?.role;
  if (!userRole || !roles.includes(userRole)) {
    return res.status(403).json({ message: 'Forbidden: insufficient permissions' });
  }

  return next();
};

const ensureDatabaseReady = (_req, res, next) => {
  if (!mongoReady) {
    return res.status(503).json({ message: 'Database is still connecting. Please try again in a moment.' });
  }

  return next();
};

const toClientPatient = (patient, user) => ({
  id: patient._id.toString(),
  profile_id: user.supabaseProfileId || user._id.toString(),
  dob: patient.dob || null,
  gender: patient.gender || 'not_specified',
  blood_group: patient.blood_group || '',
  aadhar_number: patient.aadhar_number || '',
  weight_kg: typeof patient.weight_kg === 'number' ? patient.weight_kg : null,
  height_cm: typeof patient.height_cm === 'number' ? patient.height_cm : null,
  medical_history: patient.medical_history || '',
  allergies: patient.allergies || '',
  emergency_contact_name: patient.emergency_contact_name || '',
  emergency_contact_phone: patient.emergency_contact_phone || '',
  created_at: patient.createdAt instanceof Date ? patient.createdAt.toISOString() : new Date(patient.createdAt).toISOString(),
  updated_at: patient.updatedAt instanceof Date ? patient.updatedAt.toISOString() : new Date(patient.updatedAt).toISOString(),
});

const toClientCase = (caseRow) => ({
  id: caseRow.id,
  patient_id: caseRow.patient_id,
  case_title: caseRow.case_title || '',
  case_description: caseRow.case_description || '',
  image_url: caseRow.image_url || '',
  symptoms: (() => {
    if (Array.isArray(caseRow.symptoms)) {
      return caseRow.symptoms;
    }

    if (typeof caseRow.symptoms === 'string') {
      try {
        return JSON.parse(caseRow.symptoms);
      } catch {
        return [];
      }
    }

    return [];
  })(),
  emergency_score: typeof caseRow.emergency_score === 'number' ? caseRow.emergency_score : Number(caseRow.emergency_score || 1),
  status: caseRow.status || 'submitted',
  doctor_action_status: caseRow.doctor_action_status || 'pending',
  doctor_assigned_name: caseRow.doctor_assigned_name || '',
  doctor_action_at: caseRow.doctor_action_at || null,
  created_at: caseRow.created_at,
  updated_at: caseRow.updated_at,
});

const toSafeIso = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date(0).toISOString();
  }
  return date.toISOString();
};

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mongoReady });
});

app.post('/api/auth/register', ensureDatabaseReady, async (req, res) => {
  try {
    const { full_name, email, password, phone = '', village = '', district = '', role = 'patient' } = req.body;
    const normalizedRole = String(role || 'patient').trim();
    const allowedRoles = ['patient', 'doctor', 'asha_worker', 'admin'];

    if (!full_name || !email || !password) {
      return res.status(400).json({ message: 'Full name, email, and password are required' });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    if (!allowedRoles.includes(normalizedRole)) {
      return res.status(400).json({ message: 'Invalid role selected' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ message: 'User already exists with this email' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const user = await User.create({
      fullName: String(full_name).trim(),
      email: normalizedEmail,
      passwordHash,
      phone,
      village,
      district,
      role: normalizedRole,
    });

    await syncSupabaseIdentitySafely(user, String(password));

    const supabaseProfileId = user.supabaseProfileId || null;
    const token = signToken(user._id.toString());
    const supabaseJWT = user.supabaseUserId ? await getSupabaseJWT(user.supabaseUserId) : null;

    return res.status(201).json({
      message: 'Registration successful',
      token,
      supabaseJWT,
      user: toClientUser(user, supabaseProfileId),
    });
  } catch (error) {
    console.error('Register error:', error);

    if (error?.code === 11000) {
      return res.status(409).json({ message: 'User already exists with this email' });
    }

    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: error.message || 'Invalid registration details' });
    }

    return res.status(500).json({ message: 'Failed to register user' });
  }
});

app.post('/api/auth/login', ensureDatabaseReady, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const passwordMatches = await bcrypt.compare(String(password), user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const supabaseProfileId = user.supabaseProfileId;
    const token = signToken(user._id.toString());

    return res.json({
      message: 'Login successful',
      token,
      user: toClientUser(user, supabaseProfileId),
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Failed to login' });
  }
});

app.get('/api/auth/me', authMiddleware, ensureDatabaseReady, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({ user: toClientUser(user) });
  } catch (error) {
    console.error('Me error:', error);
    return res.status(500).json({ message: 'Failed to load user' });
  }
});

app.get('/api/patients/me', authMiddleware, ensureDatabaseReady, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const patient = await PatientModel.findOne({ userId: req.userId });
    if (!patient) {
      return res.json({ patient: null });
    }

    return res.json({ patient: toClientPatient(patient, user) });
  } catch (error) {
    console.error('Patient fetch error:', error);
    return res.status(500).json({ message: 'Failed to fetch patient details' });
  }
});

app.put('/api/patients/me', authMiddleware, ensureDatabaseReady, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const payload = {
      dob: req.body?.dob || '',
      gender: req.body?.gender || 'not_specified',
      blood_group: req.body?.blood_group || '',
      aadhar_number: req.body?.aadhar_number || '',
      weight_kg: typeof req.body?.weight_kg === 'number' ? req.body.weight_kg : null,
      height_cm: typeof req.body?.height_cm === 'number' ? req.body.height_cm : null,
      medical_history: req.body?.medical_history || '',
      allergies: req.body?.allergies || '',
      emergency_contact_name: req.body?.emergency_contact_name || '',
      emergency_contact_phone: req.body?.emergency_contact_phone || '',
    };

    const patient = await PatientModel.findOneAndUpdate(
      { userId: req.userId },
      { $set: payload },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.json({
      message: 'Patient details saved successfully',
      patient: toClientPatient(patient, user),
    });
  } catch (error) {
    console.error('Patient save error:', error);
    return res.status(500).json({ message: 'Failed to save patient details' });
  }
});

app.get('/api/cases/me', authMiddleware, ensureDatabaseReady, async (req, res) => {
  try {
    const cases = await supabaseAdminRequest(`/rest/v1/patient_cases?patient_id=eq.${encodeURIComponent(req.userId)}&order=created_at.desc&limit=5`, {
      method: 'GET',
    });

    return res.json({ cases: Array.isArray(cases) ? cases.map(toClientCase) : [] });
  } catch (error) {
    console.error('Cases fetch error:', error);
    return res.status(500).json({ message: 'Failed to load cases' });
  }
});

app.post('/api/cases/me', authMiddleware, ensureDatabaseReady, async (req, res) => {
  try {
    const payload = {
      patient_id: req.userId,
      case_title: String(req.body?.case_title || '').trim(),
      case_description: String(req.body?.case_description || '').trim(),
      image_url: String(req.body?.image_url || '').trim(),
      symptoms: Array.isArray(req.body?.symptoms) ? req.body.symptoms : [],
      emergency_score: Number.isFinite(Number(req.body?.emergency_score)) ? Number(req.body.emergency_score) : 1,
      status: 'submitted',
      doctor_action_status: 'pending',
      doctor_assigned_name: '',
      doctor_action_at: null,
    };

    if (!payload.case_title || !payload.case_description) {
      return res.status(400).json({ message: 'Case title and description are required' });
    }

    const inserted = await supabaseAdminRequest('/rest/v1/patient_cases?select=*', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        Prefer: 'return=representation',
      },
    });

    const createdCase = Array.isArray(inserted) ? inserted[0] : inserted;
    return res.status(201).json({ case: createdCase ? toClientCase(createdCase) : null });
  } catch (error) {
    console.error('Case create error:', error);
    return res.status(500).json({ message: error.message || 'Failed to create case' });
  }
});

app.post('/api/medicine/recommendations', async (req, res) => {
  try {
    const disease = String(req.body?.disease || '').trim();
    const symptoms = String(req.body?.symptoms || '').trim();

    if (!disease) {
      return res.status(400).json({ message: 'Disease name is required' });
    }

    if (!symptoms) {
      return res.status(400).json({ message: 'Symptoms are required' });
    }

    if (!groqApiKey) {
      return res.status(500).json({ message: 'Missing GROQ_API_KEY in backend/.env' });
    }

    const prompt = [
      'You are a careful medical assistant for primary triage.',
      'Return strictly valid JSON only (no markdown, no prose) in this exact shape:',
      '{"medicines":[{"medicineName":"","dosage":"","timing":"","whenToTake":"","duration":"","notes":""}],"disclaimer":""}',
      'Guidelines:',
      '- Use commonly available medicine names where possible.',
      '- Include 4 to 8 items in medicines.',
      '- timing must be practical times like "8:00 AM, 2:00 PM, 8:00 PM".',
      '- if a medicine typically needs a prescription, mention this in notes.',
      '- disclaimer must clearly say user should consult a doctor and not self-medicate for severe symptoms.',
      '',
      `Disease: ${disease}`,
      `Symptoms: ${symptoms}`,
    ].join('\n');

    const callGroq = async (messages) => {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqApiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages,
        }),
      });

      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`Groq API request failed: ${raw}`);
      }

      let completion;
      try {
        completion = JSON.parse(raw);
      } catch {
        throw new Error('Invalid response envelope from Groq');
      }

      const completionContent = completion?.choices?.[0]?.message?.content;
      if (!completionContent || typeof completionContent !== 'string') {
        throw new Error('No recommendation content from Groq');
      }

      return completionContent;
    };

    const content = await callGroq([
      {
        role: 'system',
        content: 'You are a strict JSON API. Output valid JSON only.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ]);

    const tryParseRecommendation = (inputText) => {
      const candidates = [
        inputText,
        inputText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim(),
      ];

      for (const candidate of candidates) {
        try {
          return JSON.parse(candidate);
        } catch {
          const jsonMatch = candidate.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              return JSON.parse(jsonMatch[0]);
            } catch {
              continue;
            }
          }
        }
      }

      return null;
    };

    let parsed = tryParseRecommendation(content);
    if (!parsed) {
      const repairedContent = await callGroq([
        {
          role: 'system',
          content: 'Convert user content into strict valid JSON. Return JSON only and preserve meaning.',
        },
        {
          role: 'user',
          content: `Convert this to strict JSON in required schema:\n${content}`,
        },
      ]);

      parsed = tryParseRecommendation(repairedContent);
    }

    if (!parsed) {
      return res.status(502).json({ message: 'Could not parse recommendation JSON from Groq' });
    }

    const medicines = Array.isArray(parsed?.medicines)
      ? parsed.medicines
          .map((item) => ({
            medicineName: String(item?.medicineName || '').trim(),
            dosage: String(item?.dosage || '').trim(),
            timing: String(item?.timing || '').trim(),
            whenToTake: String(item?.whenToTake || '').trim(),
            duration: String(item?.duration || '').trim(),
            notes: String(item?.notes || '').trim(),
          }))
          .filter((item) => item.medicineName)
      : [];

    if (medicines.length === 0) {
      return res.status(502).json({ message: 'No medicines generated by Groq' });
    }

    return res.json({
      medicines,
      disclaimer: String(parsed?.disclaimer || 'Consult a qualified doctor before taking any medicine.'),
      input: {
        disease,
        symptoms,
      },
    });
  } catch (error) {
    console.error('Medicine recommendation error:', error);
    return res.status(500).json({ message: 'Failed to generate medicine recommendations' });
  }
});

app.get('/api/admin/users', authMiddleware, ensureDatabaseReady, loadAuthUser, requireRole('admin'), async (_req, res) => {
  try {
    const users = await User.find({}, null, { sort: { createdAt: -1 } });
    const rows = users
      .map((user) => {
        const fullName = String(user?.fullName || '').trim();
        return {
          id: user?._id ? user._id.toString() : '',
          full_name: fullName,
          email: String(user?.email || '').trim(),
          role: ['patient', 'doctor', 'asha_worker', 'admin'].includes(String(user?.role || '').toLowerCase())
            ? String(user.role).toLowerCase()
            : 'patient',
          phone: String(user?.phone || '').trim(),
          village: String(user?.village || '').trim(),
          district: String(user?.district || '').trim(),
          state: String(user?.state || '').trim(),
          created_at: toSafeIso(user?.createdAt),
        };
      })
      .filter((user) => {
        const normalizedName = String(user.full_name || '').trim().toLowerCase().replace(/\s+/g, ' ');
        return normalizedName.length > 0 && normalizedName !== 'unknown' && normalizedName !== 'unknown user';
      });

    const roleStats = {
      patient: rows.filter((u) => u.role === 'patient').length,
      doctor: rows.filter((u) => u.role === 'doctor').length,
      asha_worker: rows.filter((u) => u.role === 'asha_worker').length,
      admin: rows.filter((u) => u.role === 'admin').length,
    };

    return res.json({ users: rows, stats: roleStats, total: rows.length });
  } catch (error) {
    console.error('Admin users error:', error);
    return res.status(500).json({ message: 'Failed to fetch registered users' });
  }
});

app.get('/api/doctors', authMiddleware, ensureDatabaseReady, loadAuthUser, requireRole('asha_worker', 'doctor', 'admin'), async (_req, res) => {
  try {
    const mongoDoctors = await User.find({ role: { $regex: /^doctor$/i } }, null, { sort: { fullName: 1, createdAt: -1 } });
    const rows = mongoDoctors.map((doctor) => ({
      id: doctor.supabaseProfileId || doctor._id.toString(),
      full_name: doctor.fullName,
      role: 'doctor',
      phone: doctor.phone || '',
      village: doctor.village || '',
      district: doctor.district || '',
      state: doctor.state || '',
    }));

    try {
      const supabaseDoctors = await supabaseAdminRequest('/rest/v1/profiles?select=id,full_name,phone,village,district,state,role&role=eq.doctor&order=full_name.asc', {
        method: 'GET',
      });

      if (Array.isArray(supabaseDoctors)) {
        const seenKeys = new Set(rows.map((item) => `${String(item.id)}::${String(item.full_name).toLowerCase()}`));

        for (const doctor of supabaseDoctors) {
          const role = String(doctor.role || '').toLowerCase();
          if (role !== 'doctor') {
            continue;
          }

          const candidate = {
            id: String(doctor.id || ''),
            full_name: String(doctor.full_name || '').trim(),
            role: 'doctor',
            phone: String(doctor.phone || ''),
            village: String(doctor.village || ''),
            district: String(doctor.district || ''),
            state: String(doctor.state || ''),
          };

          if (!candidate.full_name) {
            continue;
          }

          const key = `${candidate.id}::${candidate.full_name.toLowerCase()}`;
          if (seenKeys.has(key)) {
            continue;
          }

          seenKeys.add(key);
          rows.push(candidate);
        }
      }
    } catch (supabaseError) {
      console.warn('Supabase doctors merge skipped:', supabaseError.message);
    }

    const doctorOnlyRows = rows
      .filter((person) => String(person.role || '').toLowerCase() === 'doctor')
      .filter((person) => String(person.full_name || '').trim().length > 0)
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

    return res.json({ doctors: doctorOnlyRows, total: doctorOnlyRows.length });
  } catch (error) {
    console.error('Doctors fetch error:', error);
    return res.status(500).json({ message: 'Failed to fetch doctors list' });
  }
});

app.get('/api/doctors/public', ensureDatabaseReady, async (_req, res) => {
  try {
    const mongoDoctors = await User.find({ role: { $regex: /^doctor$/i } }, null, { sort: { fullName: 1, createdAt: -1 } });
    const rows = mongoDoctors.map((doctor) => ({
      id: doctor.supabaseProfileId || doctor._id.toString(),
      full_name: doctor.fullName,
      role: 'doctor',
      phone: doctor.phone || '',
      village: doctor.village || '',
      district: doctor.district || '',
      state: doctor.state || '',
    }));

    try {
      const supabaseDoctors = await supabaseAdminRequest('/rest/v1/profiles?select=id,full_name,phone,village,district,state,role&role=eq.doctor&order=full_name.asc', {
        method: 'GET',
      });

      if (Array.isArray(supabaseDoctors)) {
        const seenKeys = new Set(rows.map((item) => `${String(item.id)}::${String(item.full_name).toLowerCase()}`));

        for (const doctor of supabaseDoctors) {
          const role = String(doctor.role || '').toLowerCase();
          if (role !== 'doctor') {
            continue;
          }

          const candidate = {
            id: String(doctor.id || ''),
            full_name: String(doctor.full_name || '').trim(),
            role: 'doctor',
            phone: String(doctor.phone || ''),
            village: String(doctor.village || ''),
            district: String(doctor.district || ''),
            state: String(doctor.state || ''),
          };

          if (!candidate.full_name) {
            continue;
          }

          const key = `${candidate.id}::${candidate.full_name.toLowerCase()}`;
          if (seenKeys.has(key)) {
            continue;
          }

          seenKeys.add(key);
          rows.push(candidate);
        }
      }
    } catch (supabaseError) {
      console.warn('Supabase public doctors merge skipped:', supabaseError.message);
    }

    const doctorOnlyRows = rows
      .filter((person) => String(person.role || '').toLowerCase() === 'doctor')
      .filter((person) => String(person.full_name || '').trim().length > 0)
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

    return res.json({ doctors: doctorOnlyRows, total: doctorOnlyRows.length });
  } catch (error) {
    console.error('Public doctors fetch error:', error);
    return res.status(500).json({ message: 'Failed to fetch doctors list' });
  }
});

app.get('/api/asha/patients', authMiddleware, ensureDatabaseReady, loadAuthUser, requireRole('asha_worker'), async (req, res) => {
  try {
    const ashaUser = req.authUser;
    const villageFilter = String(ashaUser.village || '').trim();
    const districtFilter = String(ashaUser.district || '').trim();

    const query = { role: 'patient' };
    if (villageFilter) {
      query.village = villageFilter;
    }
    if (districtFilter) {
      query.district = districtFilter;
    }

    const patients = await User.find(query, null, { sort: { createdAt: -1 } });
    const patientUserIds = patients.map((p) => p._id.toString());
    const patientDetails = await PatientModel.find({ userId: { $in: patientUserIds } });
    const detailsByUserId = new Map(patientDetails.map((row) => [row.userId, row]));

    const rows = patients.map((patientUser) => {
      const details = detailsByUserId.get(patientUser._id.toString());
      return {
        user_id: patientUser._id.toString(),
        full_name: patientUser.fullName,
        phone: patientUser.phone,
        village: patientUser.village,
        district: patientUser.district,
        registered_at: patientUser.createdAt instanceof Date ? patientUser.createdAt.toISOString() : new Date(patientUser.createdAt).toISOString(),
        gender: details?.gender || 'not_specified',
        blood_group: details?.blood_group || '',
        medical_history: details?.medical_history || '',
        allergies: details?.allergies || '',
        emergency_contact_name: details?.emergency_contact_name || '',
        emergency_contact_phone: details?.emergency_contact_phone || '',
      };
    });

    return res.json({
      assigned_village: villageFilter,
      assigned_district: districtFilter,
      total: rows.length,
      patients: rows,
    });
  } catch (error) {
    console.error('ASHA patients error:', error);
    return res.status(500).json({ message: 'Failed to fetch ASHA patient panel data' });
  }
});

freePortIfNeeded(String(port));

app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});

app.get('/api/ml/metadata', (_req, res) => {
  try {
    const metadata = getModelMetadata();
    return res.json(metadata);
  } catch (error) {
    console.error('ML metadata error:', error);
    return res.status(500).json({ message: 'Failed to load ML metadata' });
  }
});

app.post('/api/ml/diagnosis', (req, res) => {
  try {
    const payload = {
      symptom1: String(req.body?.symptom1 || '').trim(),
      symptom2: String(req.body?.symptom2 || '').trim(),
      symptom3: String(req.body?.symptom3 || '').trim(),
      temperature: String(req.body?.temperature || '').trim(),
      heartRate: String(req.body?.heartRate || '').trim(),
      bloodPressure: String(req.body?.bloodPressure || '').trim(),
      severity: String(req.body?.severity || '').trim(),
    };

    if (!payload.symptom1 || !payload.symptom2 || !payload.symptom3) {
      return res.status(400).json({ message: 'Symptom_1, Symptom_2 and Symptom_3 are required' });
    }

    if (!payload.temperature || !payload.heartRate || !payload.bloodPressure || !payload.severity) {
      return res.status(400).json({ message: 'Temperature, Heart Rate, Blood Pressure and Severity are required' });
    }

    const result = predictDiagnosis(payload);
    return res.json(result);
  } catch (error) {
    console.error('ML diagnosis error:', error);
    return res.status(500).json({ message: 'Failed to predict diagnosis' });
  }
});