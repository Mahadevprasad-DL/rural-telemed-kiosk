import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RandomForestClassifier } from 'ml-random-forest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATASET_PATH = path.join(__dirname, '..', 'supabase', 'dataset', 'disease_diagnosis.csv');

let modelState = null;

const DEFAULT_ADVICE = [
  'Take rest',
  'Drink fluids',
  'Consult doctor if severe',
];

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function parseBloodPressure(value) {
  const match = String(value || '').trim().match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
  if (!match) {
    return { systolic: 120, diastolic: 80 };
  }

  return {
    systolic: Number(match[1]),
    diastolic: Number(match[2]),
  };
}

function parseTemperatureToCelsius(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 37;
  }

  // Heuristic: values above 60 are likely in Fahrenheit.
  if (numeric > 60) {
    return (numeric - 32) * (5 / 9);
  }

  return numeric;
}

function getOrCreateCode(map, value) {
  const normalized = normalizeText(value);
  if (!map.has(normalized)) {
    map.set(normalized, map.size);
  }
  return map.get(normalized);
}

function readDatasetRows() {
  const raw = fs.readFileSync(DATASET_PATH, 'utf8');
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) {
    throw new Error('Dataset has no rows');
  }

  const headers = lines[0].split(',').map((item) => item.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = lines[i].split(',');
    if (values.length !== headers.length) {
      continue;
    }

    const row = {};
    for (let j = 0; j < headers.length; j += 1) {
      row[headers[j]] = values[j];
    }
    rows.push(row);
  }

  return rows;
}

function initializeModel() {
  if (modelState) {
    return modelState;
  }

  const rows = readDatasetRows();

  const symptomMap = new Map();
  const severityMap = new Map();
  const diagnosisMap = new Map();
  const reverseDiagnosisMap = [];
  const adviceByDiagnosis = new Map();

  const featureMatrix = [];
  const labels = [];

  for (const row of rows) {
    const symptom1 = getOrCreateCode(symptomMap, row.Symptom_1);
    const symptom2 = getOrCreateCode(symptomMap, row.Symptom_2);
    const symptom3 = getOrCreateCode(symptomMap, row.Symptom_3);
    const severity = getOrCreateCode(severityMap, row.Severity);

    const heartRate = Number(row.Heart_Rate_bpm);
    const bodyTemperatureC = Number(row.Body_Temperature_C);
    const { systolic, diastolic } = parseBloodPressure(row.Blood_Pressure_mmHg);

    const diagnosisKey = normalizeText(row.Diagnosis);
    if (!diagnosisMap.has(diagnosisKey)) {
      diagnosisMap.set(diagnosisKey, diagnosisMap.size);
      reverseDiagnosisMap.push(String(row.Diagnosis || '').trim());
    }

    const treatmentPlan = String(row.Treatment_Plan || '').trim();
    if (treatmentPlan) {
      const adviceLines = treatmentPlan
        .split(/\s*(?:\.|;|,| and )\s*/i)
        .map((line) => line.trim())
        .filter(Boolean);

      const existing = adviceByDiagnosis.get(diagnosisKey) || [];
      const merged = [...new Set([...existing, ...adviceLines])];
      adviceByDiagnosis.set(diagnosisKey, merged);
    }

    featureMatrix.push([
      symptom1,
      symptom2,
      symptom3,
      Number.isFinite(bodyTemperatureC) ? bodyTemperatureC : 37,
      Number.isFinite(heartRate) ? heartRate : 75,
      systolic,
      diastolic,
      severity,
    ]);

    labels.push(diagnosisMap.get(diagnosisKey));
  }

  if (featureMatrix.length === 0) {
    throw new Error('No valid training rows found in disease_diagnosis.csv');
  }

  const model = new RandomForestClassifier({
    nEstimators: 50,
    maxFeatures: 0.8,
    replacement: true,
    seed: 42,
  });

  model.train(featureMatrix, labels);

  modelState = {
    model,
    symptomMap,
    severityMap,
    reverseDiagnosisMap,
    adviceByDiagnosis,
  };

  return modelState;
}

function encodeSymptom(symptomMap, value) {
  const normalized = normalizeText(value);
  if (symptomMap.has(normalized)) {
    return symptomMap.get(normalized);
  }

  // Unknown symptoms fallback to first known code.
  return 0;
}

function encodeSeverity(severityMap, value) {
  const normalized = normalizeText(value);
  if (severityMap.has(normalized)) {
    return severityMap.get(normalized);
  }
  if (severityMap.has('moderate')) {
    return severityMap.get('moderate');
  }
  return 0;
}

export function getModelMetadata() {
  const state = initializeModel();

  return {
    diagnosisCount: state.reverseDiagnosisMap.length,
    diagnoses: [...state.reverseDiagnosisMap],
    symptoms: [...state.symptomMap.keys()].map((item) =>
      item
        .split(' ')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    ),
    severities: [...state.severityMap.keys()].map((item) =>
      item.charAt(0).toUpperCase() + item.slice(1)
    ),
  };
}

export function predictDiagnosis(input) {
  const state = initializeModel();

  const symptom1 = encodeSymptom(state.symptomMap, input.symptom1);
  const symptom2 = encodeSymptom(state.symptomMap, input.symptom2);
  const symptom3 = encodeSymptom(state.symptomMap, input.symptom3);

  const heartRate = Number(input.heartRate);
  const temperatureC = parseTemperatureToCelsius(input.temperature);
  const { systolic, diastolic } = parseBloodPressure(input.bloodPressure);
  const severity = encodeSeverity(state.severityMap, input.severity);

  const prediction = state.model.predict([[symptom1, symptom2, symptom3, temperatureC, Number.isFinite(heartRate) ? heartRate : 75, systolic, diastolic, severity]]);

  const diagnosisLabel = state.reverseDiagnosisMap[prediction[0]] || 'Unknown';
  const diagnosisKey = normalizeText(diagnosisLabel);
  const advice = state.adviceByDiagnosis.get(diagnosisKey) || DEFAULT_ADVICE;

  return {
    diagnosis: diagnosisLabel.toUpperCase(),
    advice: advice.length > 0 ? advice : DEFAULT_ADVICE,
    normalizedInput: {
      symptom1: String(input.symptom1 || '').trim(),
      symptom2: String(input.symptom2 || '').trim(),
      symptom3: String(input.symptom3 || '').trim(),
      temperature: String(input.temperature || '').trim(),
      heartRate: String(input.heartRate || '').trim(),
      bloodPressure: String(input.bloodPressure || '').trim(),
      severity: String(input.severity || '').trim(),
    },
  };
}
