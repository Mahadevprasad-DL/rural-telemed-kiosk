import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertCircle, BrainCircuit, HeartPulse, Thermometer } from 'lucide-react';

type MLHealthCheckPageProps = {
  profile: { id: string } | null;
};

type DiagnosisResponse = {
  diagnosis: string;
  advice: string[];
  normalizedInput: {
    symptom1: string;
    symptom2: string;
    symptom3: string;
    temperature: string;
    heartRate: string;
    bloodPressure: string;
    severity: string;
  };
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

const DEFAULT_SYMPTOMS = [
  'Fever',
  'Cough',
  'Headache',
  'Fatigue',
  'Sore throat',
  'Runny nose',
  'Body ache',
  'Shortness of breath',
];

const DEFAULT_SEVERITIES = ['Mild', 'Moderate', 'Severe'];

export function MLHealthCheckPage({ profile }: MLHealthCheckPageProps) {
  const [symptoms, setSymptoms] = useState<string[]>(DEFAULT_SYMPTOMS);
  const [severities, setSeverities] = useState<string[]>(DEFAULT_SEVERITIES);
  const [diagnosisCount, setDiagnosisCount] = useState<number>(0);
  const [diagnoses, setDiagnoses] = useState<string[]>([]);

  const [symptom1, setSymptom1] = useState('Fever');
  const [symptom2, setSymptom2] = useState('Cough');
  const [symptom3, setSymptom3] = useState('Headache');
  const [temperature, setTemperature] = useState('101');
  const [heartRate, setHeartRate] = useState('95');
  const [bloodPressure, setBloodPressure] = useState('120/80');
  const [severity, setSeverity] = useState('Moderate');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<DiagnosisResponse | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadMetadata = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/ml/metadata`);
        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as { symptoms?: string[]; severities?: string[]; diagnosisCount?: number; diagnoses?: string[] };

        if (!mounted) {
          return;
        }

        if (Array.isArray(data.symptoms) && data.symptoms.length > 0) {
          const uniqueSymptoms = [...new Set(data.symptoms.filter(Boolean))];
          setSymptoms(uniqueSymptoms);
          if (!uniqueSymptoms.includes(symptom1)) setSymptom1(uniqueSymptoms[0]);
          if (!uniqueSymptoms.includes(symptom2)) setSymptom2(uniqueSymptoms[1] || uniqueSymptoms[0]);
          if (!uniqueSymptoms.includes(symptom3)) setSymptom3(uniqueSymptoms[2] || uniqueSymptoms[0]);
        }

        if (Array.isArray(data.severities) && data.severities.length > 0) {
          const uniqueSeverities = [...new Set(data.severities.filter(Boolean))];
          setSeverities(uniqueSeverities);
          if (!uniqueSeverities.includes(severity)) {
            setSeverity(uniqueSeverities[0]);
          }
        }

        if (typeof data.diagnosisCount === 'number') {
          setDiagnosisCount(data.diagnosisCount);
        }

        if (Array.isArray(data.diagnoses)) {
          setDiagnoses(data.diagnoses.filter(Boolean));
        }
      } catch {
        // Keep defaults if metadata fetch fails.
      }
    };

    void loadMetadata();

    return () => {
      mounted = false;
    };
  }, []);

  const canSubmit = useMemo(
    () =>
      Boolean(
        symptom1.trim() &&
          symptom2.trim() &&
          symptom3.trim() &&
          temperature.trim() &&
          heartRate.trim() &&
          bloodPressure.trim() &&
          severity.trim(),
      ),
    [bloodPressure, heartRate, severity, symptom1, symptom2, symptom3, temperature],
  );

  const runDiagnosis = async () => {
    setError('');
    setResult(null);

    if (!canSubmit) {
      setError('Please enter all required values.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/ml/diagnosis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symptom1,
          symptom2,
          symptom3,
          temperature,
          heartRate,
          bloodPressure,
          severity,
        }),
      });

      const payloadText = await response.text();
      const payload = payloadText ? JSON.parse(payloadText) : null;

      if (!response.ok) {
        throw new Error(payload?.message || 'Failed to run ML diagnosis');
      }

      setResult(payload as DiagnosisResponse);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to run ML diagnosis');
    } finally {
      setLoading(false);
    }
  };

  if (!profile) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
          Login to run ML health check predictions.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
          <BrainCircuit size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">ML Health Check</h1>
          <p className="text-xs text-gray-500">Random Forest based disease diagnosis</p>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
        {diagnosisCount > 0
          ? `This dataset currently supports ${diagnosisCount} diagnosis classes.`
          : 'Loading supported diagnosis classes...'}
        {diagnosisCount > 0 && diagnosisCount < 20 ? ' If you want 20+ diagnosis targets, you need a larger dataset with more diagnosis labels.' : ''}
      </div>

      {diagnoses.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Supported diagnoses</div>
          <div className="flex flex-wrap gap-2">
            {diagnoses.map((item) => (
              <span key={item} className="px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold border border-indigo-100">
                {item}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Symptom_1</label>
            <select value={symptom1} onChange={(e) => setSymptom1(e.target.value)} className="w-full px-3 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
              {symptoms.map((item) => (
                <option key={`s1-${item}`} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Symptom_2</label>
            <select value={symptom2} onChange={(e) => setSymptom2(e.target.value)} className="w-full px-3 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
              {symptoms.map((item) => (
                <option key={`s2-${item}`} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Symptom_3</label>
            <select value={symptom3} onChange={(e) => setSymptom3(e.target.value)} className="w-full px-3 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
              {symptoms.map((item) => (
                <option key={`s3-${item}`} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Severity</label>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-full px-3 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
              {severities.map((item) => (
                <option key={`sv-${item}`} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Temperature</label>
            <div className="relative">
              <Thermometer size={15} className="absolute left-3 top-3.5 text-gray-400" />
              <input
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                placeholder="101"
                className="w-full pl-9 pr-3 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Heart Rate</label>
            <div className="relative">
              <HeartPulse size={15} className="absolute left-3 top-3.5 text-gray-400" />
              <input
                value={heartRate}
                onChange={(e) => setHeartRate(e.target.value)}
                placeholder="95"
                className="w-full pl-9 pr-3 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Blood Pressure</label>
            <div className="relative">
              <Activity size={15} className="absolute left-3 top-3.5 text-gray-400" />
              <input
                value={bloodPressure}
                onChange={(e) => setBloodPressure(e.target.value)}
                placeholder="120/80"
                className="w-full pl-9 pr-3 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        <button
          onClick={runDiagnosis}
          disabled={loading || !canSubmit}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? 'Running Random Forest...' : 'Predict Diagnosis'}
        </button>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {result && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
          <pre className="whitespace-pre-wrap break-words text-sm text-gray-800 font-mono leading-relaxed">
{`==============================
🩺 Diagnosis Result
==============================

Symptoms Entered:
- ${result.normalizedInput.symptom1}
- ${result.normalizedInput.symptom2}
- ${result.normalizedInput.symptom3}

Other Details:
- Temperature: ${result.normalizedInput.temperature}°F
- Heart Rate: ${result.normalizedInput.heartRate} bpm
- BP: ${result.normalizedInput.bloodPressure}
- Severity: ${result.normalizedInput.severity}

👉 Predicted Disease: ${result.diagnosis}

Advice:
- ${(result.advice?.[0] || 'Take rest')}
- ${(result.advice?.[1] || 'Drink fluids')}
- ${(result.advice?.[2] || 'Consult doctor if severe')}`}
          </pre>
        </div>
      )}
    </div>
  );
}
