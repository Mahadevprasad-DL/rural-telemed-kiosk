/*
  # Add doctor decision fields for patient cases

  ## Adds
  1. doctor_action_status: pending | assigned | rejected | hold
  2. doctor_assigned_name: doctor display name when assigned
  3. doctor_action_at: timestamp of the latest doctor decision
*/

ALTER TABLE public.patient_cases
  ADD COLUMN IF NOT EXISTS doctor_action_status text NOT NULL DEFAULT 'pending' CHECK (doctor_action_status IN ('pending', 'assigned', 'rejected', 'hold'));

ALTER TABLE public.patient_cases
  ADD COLUMN IF NOT EXISTS doctor_assigned_name text NOT NULL DEFAULT '';

ALTER TABLE public.patient_cases
  ADD COLUMN IF NOT EXISTS doctor_action_at timestamptz;

NOTIFY pgrst, 'reload schema';
