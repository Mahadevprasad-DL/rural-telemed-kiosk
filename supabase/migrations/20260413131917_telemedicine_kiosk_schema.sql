
/*
  # Telemedicine Kiosk - Complete Database Schema

  ## Overview
  Full schema for AI-Assisted Telemedicine KIOSK for Rural India

  ## Tables Created
  1. `profiles` - Extended user profiles with roles (patient, doctor, asha_worker, admin)
  2. `patients` - Patient demographic and medical background details
  3. `health_checks` - AI-assisted symptom check sessions and results
  4. `appointments` - Doctor appointment bookings with status tracking
  5. `consultations` - Completed doctor consultations with diagnosis
  6. `reports` - Medical reports and lab results storage
  7. `medicines` - Medicine catalog with stock information
  8. `prescriptions` - Medicine prescriptions linked to consultations
  9. `asha_workers` - Asha worker profiles and assignments
  10. `medicine_orders` - Tracking medicine distribution via Asha workers

  ## Security
  - RLS enabled on all tables
  - Role-based access policies
  - Authenticated users can access their own data
  - Asha workers and admins have elevated read access
*/

-- Profiles table extending auth.users
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  full_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'patient' CHECK (role IN ('patient', 'doctor', 'asha_worker', 'admin')),
  phone text DEFAULT '',
  village text DEFAULT '',
  district text DEFAULT '',
  state text DEFAULT 'Maharashtra',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'
    )
  );

-- Patients table
CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  dob date,
  gender text DEFAULT 'not_specified' CHECK (gender IN ('male', 'female', 'other', 'not_specified')),
  blood_group text DEFAULT '',
  aadhar_number text DEFAULT '',
  weight_kg numeric(5,2),
  height_cm numeric(5,2),
  medical_history text DEFAULT '',
  allergies text DEFAULT '',
  emergency_contact_name text DEFAULT '',
  emergency_contact_phone text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Patients can view own record"
  ON patients FOR SELECT
  TO authenticated
  USING (
    profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Patients can insert own record"
  ON patients FOR INSERT
  TO authenticated
  WITH CHECK (
    profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Patients can update own record"
  ON patients FOR UPDATE
  TO authenticated
  USING (profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()))
  WITH CHECK (profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY "Asha workers and admins can view patients"
  ON patients FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid() AND p.role IN ('asha_worker', 'admin', 'doctor')
    )
  );

-- Health Checks (AI-assisted)
CREATE TABLE IF NOT EXISTS health_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  symptoms text[] DEFAULT '{}',
  symptom_description text DEFAULT '',
  ai_diagnosis text DEFAULT '',
  severity text DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  recommended_action text DEFAULT '',
  vital_signs jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE health_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Patients can view own health checks"
  ON health_checks FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT pt.id FROM patients pt
      JOIN profiles pr ON pr.id = pt.profile_id
      WHERE pr.user_id = auth.uid()
    )
  );

CREATE POLICY "Patients can insert own health checks"
  ON health_checks FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT pt.id FROM patients pt
      JOIN profiles pr ON pr.id = pt.profile_id
      WHERE pr.user_id = auth.uid()
    )
  );

CREATE POLICY "Doctors and admins can view all health checks"
  ON health_checks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role IN ('doctor', 'admin', 'asha_worker')
    )
  );

-- Appointments
CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  doctor_name text NOT NULL DEFAULT '',
  specialty text NOT NULL DEFAULT '',
  scheduled_at timestamptz NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
  notes text DEFAULT '',
  consultation_type text DEFAULT 'video' CHECK (consultation_type IN ('video', 'in_person')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Patients can view own appointments"
  ON appointments FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT pt.id FROM patients pt
      JOIN profiles pr ON pr.id = pt.profile_id
      WHERE pr.user_id = auth.uid()
    )
  );

CREATE POLICY "Patients can insert own appointments"
  ON appointments FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT pt.id FROM patients pt
      JOIN profiles pr ON pr.id = pt.profile_id
      WHERE pr.user_id = auth.uid()
    )
  );

CREATE POLICY "Patients can update own appointments"
  ON appointments FOR UPDATE
  TO authenticated
  USING (
    patient_id IN (
      SELECT pt.id FROM patients pt
      JOIN profiles pr ON pr.id = pt.profile_id
      WHERE pr.user_id = auth.uid()
    )
  )
  WITH CHECK (
    patient_id IN (
      SELECT pt.id FROM patients pt
      JOIN profiles pr ON pr.id = pt.profile_id
      WHERE pr.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins and doctors can view all appointments"
  ON appointments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role IN ('doctor', 'admin', 'asha_worker')
    )
  );

CREATE POLICY "Admins can update all appointments"
  ON appointments FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'));

-- Consultations
CREATE TABLE IF NOT EXISTS consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  doctor_name text NOT NULL DEFAULT '',
  diagnosis text DEFAULT '',
  prescription_notes text DEFAULT '',
  follow_up_date date,
  completed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE consultations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Patients can view own consultations"
  ON consultations FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT pt.id FROM patients pt
      JOIN profiles pr ON pr.id = pt.profile_id
      WHERE pr.user_id = auth.uid()
    )
  );

CREATE POLICY "Doctors and admins can view all consultations"
  ON consultations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role IN ('doctor', 'admin', 'asha_worker')
    )
  );

CREATE POLICY "Admins can insert consultations"
  ON consultations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role IN ('admin', 'doctor'))
  );

-- Reports
CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  report_type text NOT NULL DEFAULT 'general' CHECK (report_type IN ('lab', 'xray', 'prescription', 'general', 'health_check')),
  title text NOT NULL DEFAULT '',
  description text DEFAULT '',
  file_url text DEFAULT '',
  issued_by text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Patients can view own reports"
  ON reports FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT pt.id FROM patients pt
      JOIN profiles pr ON pr.id = pt.profile_id
      WHERE pr.user_id = auth.uid()
    )
  );

CREATE POLICY "Patients can insert own reports"
  ON reports FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT pt.id FROM patients pt
      JOIN profiles pr ON pr.id = pt.profile_id
      WHERE pr.user_id = auth.uid()
    )
  );

CREATE POLICY "Doctors admins and asha workers can view all reports"
  ON reports FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role IN ('doctor', 'admin', 'asha_worker')
    )
  );

CREATE POLICY "Admins can insert any report"
  ON reports FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role IN ('admin', 'doctor'))
  );

-- Medicines catalog
CREATE TABLE IF NOT EXISTS medicines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  generic_name text DEFAULT '',
  category text DEFAULT '',
  description text DEFAULT '',
  unit text DEFAULT 'tablet',
  stock_quantity integer DEFAULT 0,
  price_per_unit numeric(8,2) DEFAULT 0,
  requires_prescription boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE medicines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated users can view medicines"
  ON medicines FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert medicines"
  ON medicines FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin')
  );

CREATE POLICY "Admins can update medicines"
  ON medicines FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'));

-- Prescriptions
CREATE TABLE IF NOT EXISTS prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid REFERENCES consultations(id) ON DELETE SET NULL,
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  medicine_id uuid REFERENCES medicines(id) ON DELETE SET NULL,
  medicine_name text NOT NULL DEFAULT '',
  dosage text NOT NULL DEFAULT '',
  frequency text DEFAULT '',
  duration_days integer DEFAULT 7,
  quantity integer DEFAULT 1,
  instructions text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Patients can view own prescriptions"
  ON prescriptions FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT pt.id FROM patients pt
      JOIN profiles pr ON pr.id = pt.profile_id
      WHERE pr.user_id = auth.uid()
    )
  );

CREATE POLICY "Doctors and admins can view all prescriptions"
  ON prescriptions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role IN ('doctor', 'admin', 'asha_worker')
    )
  );

CREATE POLICY "Admins and doctors can insert prescriptions"
  ON prescriptions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role IN ('admin', 'doctor'))
  );

-- Asha Workers
CREATE TABLE IF NOT EXISTS asha_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  worker_id text UNIQUE DEFAULT '',
  assigned_village text DEFAULT '',
  assigned_district text DEFAULT '',
  contact_number text DEFAULT '',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE asha_workers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Asha workers can view own record"
  ON asha_workers FOR SELECT
  TO authenticated
  USING (
    profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can view all asha workers"
  ON asha_workers FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin')
  );

CREATE POLICY "Admins can insert asha workers"
  ON asha_workers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin')
  );

CREATE POLICY "Admins can update asha workers"
  ON asha_workers FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'));

-- Medicine Orders
CREATE TABLE IF NOT EXISTS medicine_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE NOT NULL,
  asha_worker_id uuid REFERENCES asha_workers(id) ON DELETE SET NULL,
  prescription_id uuid REFERENCES prescriptions(id) ON DELETE SET NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'dispatched', 'delivered', 'cancelled')),
  delivery_address text DEFAULT '',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE medicine_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Patients can view own orders"
  ON medicine_orders FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT pt.id FROM patients pt
      JOIN profiles pr ON pr.id = pt.profile_id
      WHERE pr.user_id = auth.uid()
    )
  );

CREATE POLICY "Patients can insert own orders"
  ON medicine_orders FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT pt.id FROM patients pt
      JOIN profiles pr ON pr.id = pt.profile_id
      WHERE pr.user_id = auth.uid()
    )
  );

CREATE POLICY "Asha workers can view assigned orders"
  ON medicine_orders FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role IN ('asha_worker', 'admin')
    )
  );

CREATE POLICY "Asha workers can update orders"
  ON medicine_orders FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role IN ('asha_worker', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role IN ('asha_worker', 'admin')
    )
  );

-- Seed medicines catalog
INSERT INTO medicines (name, generic_name, category, description, unit, stock_quantity, price_per_unit, requires_prescription)
VALUES
  ('Paracetamol 500mg', 'Acetaminophen', 'Analgesic/Antipyretic', 'Fever and pain relief', 'tablet', 500, 1.50, false),
  ('Amoxicillin 250mg', 'Amoxicillin', 'Antibiotic', 'Bacterial infections', 'capsule', 200, 5.00, true),
  ('ORS Sachet', 'Oral Rehydration Salts', 'Rehydration', 'Diarrhea and dehydration treatment', 'sachet', 300, 3.00, false),
  ('Ibuprofen 400mg', 'Ibuprofen', 'NSAID', 'Pain, inflammation, and fever', 'tablet', 400, 2.50, false),
  ('Metformin 500mg', 'Metformin HCl', 'Antidiabetic', 'Type 2 diabetes management', 'tablet', 150, 4.00, true),
  ('Amlodipine 5mg', 'Amlodipine Besylate', 'Antihypertensive', 'High blood pressure', 'tablet', 120, 6.00, true),
  ('Cetirizine 10mg', 'Cetirizine HCl', 'Antihistamine', 'Allergies and hay fever', 'tablet', 250, 2.00, false),
  ('Omeprazole 20mg', 'Omeprazole', 'Proton Pump Inhibitor', 'Acid reflux and ulcers', 'capsule', 180, 5.50, true),
  ('Iron + Folic Acid', 'Ferrous Sulphate + Folic Acid', 'Nutritional Supplement', 'Anemia prevention', 'tablet', 400, 1.00, false),
  ('Vitamin D3 60000 IU', 'Cholecalciferol', 'Vitamin Supplement', 'Vitamin D deficiency', 'capsule', 100, 15.00, false)
ON CONFLICT DO NOTHING;
