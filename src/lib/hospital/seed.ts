// ============================================================
// Tringlo AI — Wellness Hospital demonstration data
// ============================================================
//
// Fictional records, so the panel can be shown working before a hospital has
// entered anything of its own.
//
// Three rules hold this together:
//
//   - Idempotent. Seeding twice adds nothing twice; it is keyed on stable ids
//     derived from the workspace, so a restart cannot duplicate a directory.
//   - Additive. It never edits or deletes a record someone has touched, and
//     never touches a record it did not create.
//   - Marked. Every row carries `demo: true`, which is what keeps a
//     demonstration appointment from ever being dialled.
//
// Every doctor, patient and appointment below is invented. The names are
// fictional, the qualifications are omitted rather than made up, and the
// avatars are drawn illustrations, not photographs of anyone.
//
// Where the doctors go: into the DEMONSTRATION HOSPITAL SERVER's provider
// directory, not into Tringlo. Tringlo has no doctor management — the panel
// cannot create, edit or delete one — and this seed is the stand-in hospital
// system being given something to serve. The same rows reach the panel only by
// being read back through the integration adapter.
//
// The patients are seeded twice over, on purpose: once into the stand-in's own
// patient directory, with a date of birth, so that identity can be verified
// the way a hospital verifies it; and once as Tringlo leads, which is what the
// call history and appointments hang off. That separation is what lets the
// demonstration produce a caller the hospital has never heard of.
// ============================================================

import {
  getAppointments,
  getDoctors,
  getHisPatients,
  getHospitalFaqs,
  saveDoctor,
  saveHisPatient,
  saveHospitalFaq,
} from "@/lib/db";
import { bookAppointment, hospitalProfile, localDate, patientFor, slotsFor } from "./service";
import { defaultSchedule, type Doctor, type Weekday } from "./types";

interface SeedDoctor {
  slug: string;
  name: string;
  specialty: string;
  department: string;
  days: Weekday[];
  start: string;
  end: string;
  slotMinutes: number;
}

const WEEK: Weekday[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const WITH_SAT: Weekday[] = [...WEEK, "Saturday"];

/** Twenty fictional doctors, with schedules a hospital can edit or remove. */
const DOCTORS: SeedDoctor[] = [
  { slug: "aarav-mehta", name: "Dr. Aarav Mehta", specialty: "General Medicine", department: "Medicine", days: WITH_SAT, start: "09:00", end: "17:00", slotMinutes: 20 },
  { slug: "nisha-rao", name: "Dr. Nisha Rao", specialty: "Cardiology", department: "Cardiac Sciences", days: WEEK, start: "10:00", end: "16:00", slotMinutes: 30 },
  { slug: "kabir-shah", name: "Dr. Kabir Shah", specialty: "Neurology", department: "Neurosciences", days: ["Monday", "Wednesday", "Friday"], start: "11:00", end: "17:00", slotMinutes: 30 },
  { slug: "meera-nair", name: "Dr. Meera Nair", specialty: "Pediatrics", department: "Child Health", days: WITH_SAT, start: "09:00", end: "15:00", slotMinutes: 20 },
  { slug: "rohan-kulkarni", name: "Dr. Rohan Kulkarni", specialty: "Orthopedics", department: "Orthopedics", days: WEEK, start: "10:00", end: "18:00", slotMinutes: 30 },
  { slug: "ananya-iyer", name: "Dr. Ananya Iyer", specialty: "Obstetrics & Gynecology", department: "Women's Health", days: WEEK, start: "09:30", end: "16:30", slotMinutes: 30 },
  { slug: "vikram-desai", name: "Dr. Vikram Desai", specialty: "Dermatology", department: "Skin & Aesthetics", days: ["Tuesday", "Thursday", "Saturday"], start: "11:00", end: "17:00", slotMinutes: 20 },
  { slug: "farah-khan", name: "Dr. Farah Khan", specialty: "ENT", department: "ENT", days: WEEK, start: "09:00", end: "15:00", slotMinutes: 20 },
  { slug: "arjun-menon", name: "Dr. Arjun Menon", specialty: "Gastroenterology", department: "Digestive Health", days: ["Monday", "Tuesday", "Thursday", "Friday"], start: "10:00", end: "16:00", slotMinutes: 30 },
  { slug: "sneha-patil", name: "Dr. Sneha Patil", specialty: "Pulmonology", department: "Respiratory Medicine", days: WEEK, start: "09:00", end: "16:00", slotMinutes: 30 },
  { slug: "karthik-reddy", name: "Dr. Karthik Reddy", specialty: "Endocrinology & Diabetology", department: "Medicine", days: WEEK, start: "10:00", end: "17:00", slotMinutes: 20 },
  { slug: "pooja-bhat", name: "Dr. Pooja Bhat", specialty: "Nephrology", department: "Renal Sciences", days: ["Monday", "Wednesday", "Friday"], start: "09:00", end: "15:00", slotMinutes: 30 },
  { slug: "aditya-bose", name: "Dr. Aditya Bose", specialty: "Urology", department: "Renal Sciences", days: ["Tuesday", "Thursday", "Saturday"], start: "10:00", end: "16:00", slotMinutes: 30 },
  { slug: "leena-thomas", name: "Dr. Leena Thomas", specialty: "Psychiatry", department: "Mental Health", days: WEEK, start: "11:00", end: "18:00", slotMinutes: 45 },
  { slug: "sanjay-kapoor", name: "Dr. Sanjay Kapoor", specialty: "Ophthalmology", department: "Eye Care", days: WITH_SAT, start: "09:00", end: "16:00", slotMinutes: 20 },
  { slug: "divya-shetty", name: "Dr. Divya Shetty", specialty: "Oncology", department: "Cancer Care", days: ["Monday", "Tuesday", "Wednesday", "Thursday"], start: "10:00", end: "16:00", slotMinutes: 45 },
  { slug: "rahul-verma", name: "Dr. Rahul Verma", specialty: "Dentistry & Oral Health", department: "Dental", days: WITH_SAT, start: "09:30", end: "17:30", slotMinutes: 30 },
  { slug: "isha-banerjee", name: "Dr. Isha Banerjee", specialty: "Rheumatology", department: "Medicine", days: ["Tuesday", "Wednesday", "Friday"], start: "10:00", end: "15:00", slotMinutes: 30 },
  { slug: "manish-gowda", name: "Dr. Manish Gowda", specialty: "Physiotherapy & Rehabilitation", department: "Rehabilitation", days: WITH_SAT, start: "08:00", end: "14:00", slotMinutes: 45 },
  { slug: "zoya-fernandes", name: "Dr. Zoya Fernandes", specialty: "Emergency Medicine", department: "Emergency", days: WEEK, start: "08:00", end: "20:00", slotMinutes: 20 },
];

/**
 * Fictional patients.
 *
 * `inDirectory` is the interesting field: a patient the stand-in hospital has
 * a record of can be identified and comes through as returning, and one it
 * does not is the new patient the questionnaire exists for. The dates of birth
 * are what identity is corroborated against, because a phone number is not
 * identity.
 */
const PATIENTS = [
  { name: "Ananya Rao", phone: "+919845012210", dateOfBirth: "1986-04-11", inDirectory: true, hasHistory: true },
  { name: "Rohan Mehta", phone: "+919900144210", dateOfBirth: "1979-11-02", inDirectory: true, hasHistory: true },
  { name: "Kiran Shah", phone: "+919811122233", dateOfBirth: "1994-07-23", inDirectory: true, hasHistory: false },
  { name: "Meera Iyer", phone: "+919822233344", dateOfBirth: "1968-01-30", inDirectory: true, hasHistory: false },
  { name: "Arjun Nair", phone: "+919833344455", dateOfBirth: "2001-09-14", inDirectory: true, hasHistory: false },
  { name: "Divya Menon", phone: "+919844455566", dateOfBirth: "1990-03-05", inDirectory: true, hasHistory: false },
  // Not in the hospital's directory: these two are new patients.
  { name: "Vikram Joshi", phone: "+919855566677", dateOfBirth: "1983-12-19", inDirectory: false, hasHistory: false },
  { name: "Sneha Kulkarni", phone: "+919866677788", dateOfBirth: "1997-06-08", inDirectory: false, hasHistory: false },
];

const FAQS = [
  { topic: "Appointment booking", question: "How do I book an appointment?", answer: "Call the hospital and our assistant can book you in with the right department, or ask the front desk." },
  { topic: "Appointment booking", question: "Can I reschedule or cancel?", answer: "Yes. Call us and give the name the appointment was booked under; we will move it to another slot or cancel it." },
  { topic: "Administrative", question: "Do I need to arrive early?", answer: "Please arrive about fifteen minutes before your appointment so registration is done before your slot." },
  { topic: "Administrative", question: "What should I bring?", answer: "Any previous prescriptions or reports relating to the problem, and a form of identification." },
  { topic: "Departments and services", question: "Which departments does the hospital have?", answer: "The current list of departments and consulting doctors is kept up to date in the hospital's directory, which the assistant reads from." },
];

/** A stable id, so seeding twice writes the same rows rather than new ones. */
const seedId = (tenantId: string, kind: string, key: string) => `${kind}_seed_${tenantId}_${key}`;

export interface SeedReport {
  doctors: number;
  patients: number;
  /** Patients given to the demonstration hospital server's own directory. */
  hisPatients: number;
  appointments: number;
  faqs: number;
  alreadyPresent: boolean;
}

/**
 * Fills a workspace with the demonstration hospital.
 *
 * Returns what it added. A second run adds nothing: the doctors are keyed on
 * their slug within this workspace, and appointments are only created when
 * this workspace has none at all, so a hospital that has started booking is
 * never given demonstration rows on top of its own.
 */
export function seedHospital(tenantId: string): SeedReport {
  const profile = hospitalProfile(tenantId);
  const report: SeedReport = { doctors: 0, patients: 0, hisPatients: 0, appointments: 0, faqs: 0, alreadyPresent: false };

  const existingDoctors = new Set(getDoctors(tenantId).map((doctor) => doctor.id));
  const now = new Date().toISOString();

  for (const entry of DOCTORS) {
    const id = seedId(tenantId, "doc", entry.slug);
    if (existingDoctors.has(id)) continue;
    const doctor: Doctor = {
      id,
      tenantId,
      name: entry.name,
      specialty: entry.specialty,
      department: entry.department,
      // Left empty on purpose: a qualification is a claim about a real
      // person's training, and these people are invented.
      qualifications: null,
      about: null,
      avatar: `/hospital/doctors/${entry.slug}.svg`,
      phone: null,
      email: null,
      schedule: {
        ...defaultSchedule(),
        days: entry.days,
        start: entry.start,
        end: entry.end,
        slotMinutes: entry.slotMinutes,
      },
      exceptions: [],
      status: "active",
      demo: true,
      createdAt: now,
      updatedAt: now,
    };
    saveDoctor(doctor);
    report.doctors += 1;
  }

  // Into the stand-in's own patient directory, so identity verification has
  // something to verify against.
  const existingHisPatients = new Set(getHisPatients(tenantId).map((patient) => patient.id));
  for (const patient of PATIENTS) {
    if (!patient.inDirectory) continue;
    const id = seedId(tenantId, "hisp", patient.phone.replace(/\D/g, ""));
    if (existingHisPatients.has(id)) continue;
    saveHisPatient({
      id,
      tenantId,
      patientId: `WH-${patient.phone.slice(-6)}`,
      name: patient.name,
      phone: patient.phone,
      dateOfBirth: patient.dateOfBirth,
      hasHistory: patient.hasHistory,
      demo: true,
      createdAt: now,
    });
    report.hisPatients += 1;
  }

  const existingFaqs = new Set(getHospitalFaqs(tenantId).map((faq) => faq.id));
  FAQS.forEach((faq, index) => {
    const id = seedId(tenantId, "faq", String(index));
    if (existingFaqs.has(id)) return;
    saveHospitalFaq({
      id,
      tenantId,
      question: faq.question,
      answer: faq.answer,
      topic: faq.topic,
      active: true,
      demo: true,
      createdAt: now,
      updatedAt: now,
    });
    report.faqs += 1;
  });

  // Appointments are only seeded into a hospital that has none. Once anyone
  // has booked anything, this stops contributing entirely.
  if (getAppointments(tenantId).length === 0) {
    const doctors = getDoctors(tenantId).filter((doctor) => doctor.demo);
    const today = new Date();

    PATIENTS.forEach((patient, index) => {
      patientFor(tenantId, patient.phone, patient.name);
      report.patients += 1;

      const doctor = doctors[index % doctors.length];
      if (!doctor) return;

      // Spread across the next few days so the dashboard has something to
      // show for "today" and "upcoming" without inventing past activity.
      const dayOffset = index % 5;
      const date = localDate(new Date(today.getTime() + dayOffset * 86400_000), profile.timezone);
      const slots = slotsFor(tenantId, doctor.id, date);
      const slot = slots.find((entry) => entry.available);
      if (!slot) return;

      const booked = bookAppointment({
        tenantId,
        doctorId: doctor.id,
        date,
        time: slot.time,
        patientName: patient.name,
        patientPhone: patient.phone,
        reason: "Demonstration booking",
        source: "seed",
        status: index % 4 === 0 ? "requested" : "confirmed",
        demo: true,
        actor: "seed",
      });
      if (booked.ok) report.appointments += 1;
    });
  }

  report.alreadyPresent =
    report.doctors === 0 && report.faqs === 0 && report.appointments === 0 && report.hisPatients === 0;
  console.log(
    `HOSPITAL_SEED tenant=${tenantId} doctors=${report.doctors} appointments=${report.appointments} faqs=${report.faqs}`
  );
  return report;
}
