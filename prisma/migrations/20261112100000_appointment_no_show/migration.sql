-- Reception can record that a booked patient did not come, separately from a cancellation.
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'NO_SHOW';
