"use client";

import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  Filter,
  HeartPulse,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Stethoscope,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

type Section = "today" | "patients" | "whatsapp" | "queue" | "follow-ups";
type VisitStatus = "Booked" | "Arrived" | "In consultation" | "Completed";
type Appointment = {
  id: string;
  reference: string;
  patient: string;
  phone: string;
  doctor: string;
  department: string;
  time: string;
  type: string;
  status: VisitStatus;
};
type Patient = {
  name: string;
  phone: string;
  age: number;
  lastVisit: string;
  nextVisit: string;
};

const starterPatients: Patient[] = [
  { name: "Ananya Rao", phone: "+91 98765 43210", age: 34, lastVisit: "18 Oct 2026", nextVisit: "Today, 9:00 AM" },
  { name: "Rahul Mehta", phone: "+91 98201 45678", age: 52, lastVisit: "02 Sep 2026", nextVisit: "Today, 9:30 AM" },
  { name: "Meera Iyer", phone: "+91 98450 11223", age: 28, lastVisit: "12 Oct 2026", nextVisit: "Today, 10:00 AM" },
  { name: "Kabir Shah", phone: "+91 98190 33445", age: 41, lastVisit: "—", nextVisit: "Today, 10:30 AM" },
  { name: "Aarav Kapoor", phone: "+91 98990 56789", age: 16, lastVisit: "05 Aug 2026", nextVisit: "Today, 11:00 AM" },
  { name: "Zoya Khan", phone: "+91 99887 66554", age: 45, lastVisit: "21 Oct 2026", nextVisit: "Today, 11:30 AM" },
];

const starterAppointments: Appointment[] = [
  { id: "a1", reference: "DD-1026-041", patient: "Ananya Rao", phone: "+91 98765 43210", doctor: "Dr. Aditi Rao", department: "Cardiology", time: "09:00", type: "Follow-up", status: "Arrived" },
  { id: "a2", reference: "DD-1026-042", patient: "Rahul Mehta", phone: "+91 98201 45678", doctor: "Dr. Aditi Rao", department: "Cardiology", time: "09:30", type: "Consultation", status: "In consultation" },
  { id: "a3", reference: "DD-1026-043", patient: "Meera Iyer", phone: "+91 98450 11223", doctor: "Dr. Aditi Rao", department: "Cardiology", time: "10:00", type: "Consultation", status: "Booked" },
  { id: "a4", reference: "DD-1026-044", patient: "Kabir Shah", phone: "+91 98190 33445", doctor: "Dr. Neel Shah", department: "Dermatology", time: "10:30", type: "New visit", status: "Booked" },
  { id: "a5", reference: "DD-1026-045", patient: "Aarav Kapoor", phone: "+91 98990 56789", doctor: "Dr. Neel Shah", department: "Dermatology", time: "11:00", type: "Follow-up", status: "Booked" },
  { id: "a6", reference: "DD-1026-046", patient: "Zoya Khan", phone: "+91 99887 66554", doctor: "Dr. Sana Ali", department: "General medicine", time: "11:30", type: "Consultation", status: "Booked" },
];

const starterFollowUps = [
  { name: "Ananya Rao", department: "Cardiology", doctor: "Dr. Aditi Rao", when: "Today", kind: "Follow-up", reason: "Review blood pressure", status: "Due today" },
  { name: "Zoya Khan", department: "General medicine", doctor: "Dr. Sana Ali", when: "28 Oct 2026", kind: "Revision", reason: "Review current plan", status: "Invitation not sent" },
  { name: "Aarav Kapoor", department: "Dermatology", doctor: "Dr. Neel Shah", when: "02 Nov 2026", kind: "Follow-up", reason: "Skin review", status: "Booked" },
];

const conversations = [
  { name: "Priya Nair", phone: "+91 98670 12345", initials: "PN", preview: "Could I move my appointment to Friday?", time: "2m", unread: 2, color: "lavender" },
  { name: "Vikram Das", phone: "+91 98490 67812", initials: "VD", preview: "Thank you, that works for me.", time: "18m", unread: 0, color: "sage" },
  { name: "Fatima Sheikh", phone: "+91 98730 11220", initials: "FS", preview: "What time does the clinic open?", time: "42m", unread: 1, color: "peach" },
  { name: "Rohan Kulkarni", phone: "+91 98800 22011", initials: "RK", preview: "I need to speak with reception.", time: "1h", unread: 0, color: "blue" },
];

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const calendarDays = [
  { day: 28, muted: true }, { day: 29, muted: true }, { day: 30, muted: true }, { day: 1, muted: false },
  { day: 2, muted: false }, { day: 3, muted: false }, { day: 4, muted: false },
  { day: 5, muted: false }, { day: 6, muted: false }, { day: 7, muted: false }, { day: 8, muted: false },
  { day: 9, muted: false }, { day: 10, muted: false }, { day: 11, muted: false },
  { day: 12, muted: false }, { day: 13, muted: false }, { day: 14, muted: false }, { day: 15, muted: false },
  { day: 16, muted: false }, { day: 17, muted: false }, { day: 18, muted: false },
  { day: 19, muted: false }, { day: 20, muted: false }, { day: 21, muted: false }, { day: 22, muted: false },
  { day: 23, muted: false }, { day: 24, muted: false }, { day: 25, muted: false },
  { day: 26, muted: false }, { day: 27, muted: false }, { day: 28, muted: false }, { day: 29, muted: false },
  { day: 30, muted: false }, { day: 31, muted: false }, { day: 1, muted: true },
];

function formatTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function SectionHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="section-description">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function StatusPill({ status }: { status: VisitStatus | string }) {
  const className = status.toLowerCase().replaceAll(" ", "-");
  return <span className={`status-pill ${className}`}><i />{status}</span>;
}

function NewPatientDialog({ onClose, onSave }: { onClose: () => void; onSave: (patient: Patient) => void }) {
  const [formError, setFormError] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [age, setAge] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phone.replace(/\D/g, "").length < 10) {
      setFormError("Enter a valid phone number with at least 10 digits.");
      return;
    }
    onSave({
      name: name.trim(),
      phone: phone.trim(),
      age: Number(age),
      lastVisit: "New patient",
      nextVisit: "Not booked",
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="patient-dialog-title">
        <div className="dialog-heading">
          <div><p className="eyebrow">PATIENT RECORD</p><h2 id="patient-dialog-title">Register a patient</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="dialog-form">
          <label>Full name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} required minLength={2} placeholder="e.g. Ananya Rao" /></label>
          <label>Phone number<input value={phone} onChange={(event) => setPhone(event.target.value)} required inputMode="tel" placeholder="+91 98765 43210" /></label>
          <label>Age<input value={age} onChange={(event) => setAge(event.target.value)} required type="number" min="0" max="125" placeholder="Age" /></label>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">Register patient</button></div>
        </form>
        <p className="dialog-note"><ShieldCheck size={14} /> Demo entry only. No health data is saved.</p>
      </section>
    </div>
  );
}

function NewAppointmentDialog({ patients, onClose, onSave }: { patients: Patient[]; onClose: () => void; onSave: (appointment: Appointment) => void }) {
  const [patientName, setPatientName] = useState(patients[0]?.name ?? "");
  const [doctor, setDoctor] = useState("Dr. Aditi Rao");
  const [date, setDate] = useState("2026-10-26");
  const [time, setTime] = useState("12:00");
  const [department, setDepartment] = useState("Cardiology");
  const [issue, setIssue] = useState("");
  const [error, setError] = useState("");
  const doctorsByDepartment: Record<string, string[]> = {
    Cardiology: ["Dr. Aditi Rao"],
    Dermatology: ["Dr. Neel Shah"],
    "General medicine": ["Dr. Sana Ali"],
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (date < "2026-10-26") {
      setError("Appointments can’t be booked in the past.");
      return;
    }
    const patient = patients.find((item) => item.name === patientName);
    if (!patient) {
      setError("Choose a registered patient.");
      return;
    }
    const dateReference = date.replaceAll("-", "").slice(2);
    onSave({
      id: `a-${Date.now()}`,
      reference: `DD-${dateReference}-${Date.now().toString(36).slice(-4).toUpperCase()}`,
      patient: patient.name,
      phone: patient.phone,
      doctor,
      department,
      time,
      type: issue.trim() || "Consultation",
      status: "Booked",
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="appointment-dialog-title">
        <div className="dialog-heading">
          <div><p className="eyebrow">RECEPTION</p><h2 id="appointment-dialog-title">New appointment</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="dialog-form">
          <label>Patient<select value={patientName} onChange={(event) => setPatientName(event.target.value)}>{patients.map((item) => <option key={item.phone} value={item.name}>{item.name}</option>)}</select></label>
          <div className="form-row">
            <label>Department<select value={department} onChange={(event) => { setDepartment(event.target.value); setDoctor(doctorsByDepartment[event.target.value][0]); }}>{Object.keys(doctorsByDepartment).map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Doctor<select value={doctor} onChange={(event) => setDoctor(event.target.value)}>{doctorsByDepartment[department].map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
          <div className="form-row">
            <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
            <label>Time<input type="time" value={time} onChange={(event) => setTime(event.target.value)} required /></label>
          </div>
          <label>Visit type<select value={issue} onChange={(event) => setIssue(event.target.value)}><option value="">Consultation</option><option>Follow-up</option><option>Revision</option><option>Walk-in</option></select></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="availability-note"><Clock3 size={15} /><span>Sample schedule · 30 min · availability is not checked in simulator mode.</span></div>
          <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">Create appointment</button></div>
        </form>
        <p className="dialog-note"><ShieldCheck size={14} /> Demo entry only. No appointment is booked.</p>
      </section>
    </div>
  );
}

export default function DocDeskDashboard() {
  const [section, setSection] = useState<Section>("today");
  const [appointments, setAppointments] = useState(starterAppointments);
  const [patients, setPatients] = useState(starterPatients);
  const [search, setSearch] = useState("");
  const [showPatientDialog, setShowPatientDialog] = useState(false);
  const [showAppointmentDialog, setShowAppointmentDialog] = useState(false);
  const [selectedChat, setSelectedChat] = useState(0);
  const [handover, setHandover] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [consulting, setConsulting] = useState<Appointment | null>(null);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("Stable");
  const [needsFollowUp, setNeedsFollowUp] = useState(true);
  const [followUpType, setFollowUpType] = useState("Follow-up");
  const [followUpDate, setFollowUpDate] = useState("2026-11-23");
  const [internalReason, setInternalReason] = useState("");
  const [patientFacingPreview, setPatientFacingPreview] = useState("");
  const [toast, setToast] = useState("");

  const filteredAppointments = useMemo(() => appointments.filter((appointment) => {
    const query = search.toLowerCase().trim();
    return !query || `${appointment.patient} ${appointment.phone} ${appointment.reference} ${appointment.doctor}`.toLowerCase().includes(query);
  }), [appointments, search]);

  const filteredPatients = useMemo(() => patients.filter((patient) => {
    const query = search.toLowerCase().trim();
    return !query || `${patient.name} ${patient.phone}`.toLowerCase().includes(query);
  }), [patients, search]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }

  function advanceAppointment(id: string) {
    setAppointments((current) => current.map((appointment) => {
      if (appointment.id !== id) return appointment;
      const next: Record<VisitStatus, VisitStatus> = {
        Booked: "Arrived",
        Arrived: "In consultation",
        "In consultation": "Completed",
        Completed: "Completed",
      };
      return { ...appointment, status: next[appointment.status] };
    }));
  }

  function addPatient(patient: Patient) {
    const phone = patient.phone.replace(/\D/g, "");
    if (patients.some((entry) => entry.phone.replace(/\D/g, "") === phone)) {
      notify("Possible duplicate: a patient already uses this phone number.");
      return;
    }
    setPatients((current) => [patient, ...current]);
    setShowPatientDialog(false);
    notify("Patient added to this demo session.");
  }

  function addAppointment(appointment: Appointment) {
    setAppointments((current) => [...current, appointment].sort((left, right) => left.time.localeCompare(right.time)));
    setShowAppointmentDialog(false);
    notify("Appointment added to this demo session.");
  }

  function startConsultation(appointment: Appointment) {
    setConsulting(appointment);
    setNote("");
    setOutcome("Stable");
    setNeedsFollowUp(true);
    setInternalReason("");
    setPatientFacingPreview("");
  }

  function saveConsultation(complete: boolean) {
    if (!note.trim()) {
      notify("Add a note before saving the consultation.");
      return;
    }
    setAppointments((current) => current.map((appointment) => appointment.id === consulting?.id
      ? { ...appointment, status: complete ? "Completed" : appointment.status }
      : appointment));
    setConsulting(null);
    notify(complete ? "Visit marked complete in this demo session." : "Draft saved in this demo session.");
  }

  const titleBySection: Record<Section, { eyebrow: string; title: string; description: string }> = {
    today: { eyebrow: "MONDAY, 26 OCTOBER", title: "Good morning, Maya", description: "Here’s what’s happening at your clinic today." },
    patients: { eyebrow: "CLINIC DIRECTORY", title: "Patients", description: "Find patient contact details and their upcoming visit." },
    whatsapp: { eyebrow: "PATIENT MESSAGING", title: "WhatsApp inbox", description: "Shared reception inbox · development simulator" },
    queue: { eyebrow: "DOCTOR WORKSPACE", title: "My queue", description: "Your appointments, in chronological order." },
    "follow-ups": { eyebrow: "ONGOING CARE", title: "Follow-ups", description: "Keep a clear view of upcoming and unbooked visits." },
  };
  const heading = titleBySection[section];
  const unfinishedVisits = appointments.filter((item) => item.status !== "Completed").length;

  function navigate(next: Section) {
    setSection(next);
    setMobileMenu(false);
    setSearch("");
  }

  const navigation = [
    { id: "today" as const, label: "Today", icon: CalendarDays },
    { id: "patients" as const, label: "Patients", icon: UsersRound },
    { id: "whatsapp" as const, label: "WhatsApp", icon: MessageCircle, badge: "3" },
    { id: "queue" as const, label: "Doctor queue", icon: Stethoscope },
    { id: "follow-ups" as const, label: "Follow-ups", icon: CalendarCheck, badge: "2" },
  ];

  const sidebar = (
    <>
      <div className="brand">
        <span className="brand-mark">d.</span>
        <div><strong>docdesk</strong><span>CLINIC WORKSPACE</span></div>
        <button className="mobile-close icon-button" aria-label="Close navigation" onClick={() => setMobileMenu(false)}><X size={18} /></button>
      </div>
      <div className="clinic-select">
        <span className="clinic-avatar"><HeartPulse size={18} /></span>
        <span><strong>Willow Health Clinic</strong><small>Hyderabad · Main clinic</small></span>
        <ChevronDown size={15} />
      </div>
      <div className="nav-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation">
        {navigation.map(({ id, label, icon: Icon, badge }) => (
          <button key={id} onClick={() => navigate(id)} className={`nav-item ${section === id ? "active" : ""}`}>
            <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{badge && <span className="nav-badge">{badge}</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button className="nav-item" onClick={() => notify("Settings are available after connecting a clinic account.")}><Settings2 size={18} /><span>Clinic settings</span></button>
        <div className="sidebar-help"><span className="help-icon"><CircleHelp size={17} /></span><div><strong>Need a hand?</strong><small>Visit the help center</small></div><ArrowRight size={14} /></div>
        <div className="profile-row"><span className="profile-avatar">MR</span><span><strong>Maya Reddy</strong><small>Receptionist · Demo</small></span><MoreHorizontal size={18} /></div>
      </div>
    </>
  );

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>{sidebar}</aside>
      {mobileMenu && <button aria-label="Close navigation" className="mobile-scrim" onClick={() => setMobileMenu(false)} />}
      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setMobileMenu(true)}><Menu size={20} /></button>
            <span className="breadcrumb">Willow Health Clinic <ChevronRight size={14} /> <strong>{navigation.find((item) => item.id === section)?.label}</strong></span>
          </div>
          <div className="topbar-right">
            <span className="demo-chip"><span /> Demo mode</span>
            <button className="topbar-avatar" aria-label="Maya Reddy profile">MR</button>
          </div>
        </header>
        <div className="workspace">
          <div className="demo-banner">
            <ShieldCheck size={16} />
            <p><strong>Development simulator</strong><span>Fictional sample records. Changes stay in this browser session and no messages are sent.</span></p>
            <button className="banner-close" aria-label="Dismiss simulator notice" onClick={(event) => event.currentTarget.parentElement?.classList.add("banner-dismissed")}><X size={16} /></button>
          </div>
          <SectionHeading
            eyebrow={heading.eyebrow}
            title={heading.title}
            description={heading.description}
            action={section === "today" || section === "patients" ? (
              <div className="heading-actions">
                <button className="button button-quiet" onClick={() => setShowPatientDialog(true)}><UserRound size={16} /> Register patient</button>
                <button className="button button-primary" onClick={() => setShowAppointmentDialog(true)}><Plus size={17} /> New appointment</button>
              </div>
            ) : section === "queue" ? <span className="today-filter"><CalendarDays size={15} /> Today <ChevronDown size={14} /></span> : undefined}
          />

          {section === "today" && (
            <>
              <div className="metric-grid">
                <Metric label="Appointments today" value={appointments.length.toString()} detail={`${unfinishedVisits} still to come`} icon={<CalendarDays size={18} />} tone="blue" />
                <Metric label="Checked in" value={appointments.filter((item) => item.status === "Arrived" || item.status === "In consultation").length.toString()} detail="1 in consultation" icon={<UsersRound size={18} />} tone="sage" />
                <Metric label="Completed visits" value={appointments.filter((item) => item.status === "Completed").length.toString()} detail="Updated just now" icon={<CheckCheck size={18} />} tone="lavender" />
                <Metric label="WhatsApp inbox" value="3" detail="Needs a reply" icon={<MessageCircle size={18} />} tone="peach" />
              </div>
              <div className="dashboard-layout">
                <section className="panel appointments-panel">
                  <div className="panel-heading">
                    <div><h2>Today’s appointments</h2><p>Monday, 26 October · 3 doctors</p></div>
                    <div className="panel-actions"><button className="icon-button" aria-label="Filter appointments" onClick={() => notify("Showing appointments across all departments.")}><Filter size={17} /></button><button className="button button-outline button-small" onClick={() => navigate("queue")}>View queue <ArrowRight size={14} /></button></div>
                  </div>
                  <div className="appointment-toolbar"><span><span className="live-dot" /> Live schedule</span><div><button aria-label="Previous day" className="icon-button" onClick={() => notify("Sample schedule is fixed to Monday, 26 October.")}><ChevronLeft size={16} /></button><button className="date-shortcut">Today</button><button aria-label="Next day" className="icon-button" onClick={() => notify("Sample schedule is fixed to Monday, 26 October.")}><ChevronRight size={16} /></button></div></div>
                  <div className="appointment-list">
                    {filteredAppointments.map((appointment) => (
                      <AppointmentRow key={appointment.id} appointment={appointment} onAdvance={() => advanceAppointment(appointment.id)} onConsult={() => startConsultation(appointment)} />
                    ))}
                    {filteredAppointments.length === 0 && <EmptyState title="No matching appointments" detail="Try another name, phone number or reference." />}
                  </div>
                  <div className="schedule-footer"><span>Showing {filteredAppointments.length} of {appointments.length} appointments</span><button onClick={() => navigate("queue")}>Open doctor queue <ArrowRight size={14} /></button></div>
                </section>
                <aside className="right-rail">
                  <div className="panel mini-calendar">
                    <div className="mini-calendar-heading"><div><h2>October 2026</h2><p>Clinic calendar</p></div><span className="calendar-actions"><button aria-label="Previous month" onClick={() => notify("Calendar preview is fixed to October 2026.")}><ChevronLeft size={15} /></button><button aria-label="Next month" onClick={() => notify("Calendar preview is fixed to October 2026.")}><ChevronRight size={15} /></button></span></div>
                    <div className="calendar-grid">{weekdays.map((day) => <span key={day} className="weekday">{day[0]}</span>)}{calendarDays.map((day, index) => <button key={`${day.day}-${index}`} className={`${day.muted ? "muted" : ""} ${day.day === 26 && !day.muted ? "selected" : ""} ${[6, 12, 19, 26, 32].includes(index) ? "has-events" : ""}`} onClick={() => day.day === 26 && !day.muted ? undefined : notify("Only the sample date is available in simulator mode.")}>{day.day}</button>)}</div>
                    <div className="calendar-legend"><span><i className="legend-dot legend-blue" /> Appointments</span><span><i className="legend-dot legend-sage" /> Follow-up</span></div>
                  </div>
                  <div className="panel department-card">
                    <div className="panel-heading compact"><div><h2>By department</h2><p>Today’s schedule</p></div><MoreHorizontal size={18} /></div>
                    <DepartmentRow name="Cardiology" count="3 visits" color="blue" />
                    <DepartmentRow name="Dermatology" count="2 visits" color="sage" />
                    <DepartmentRow name="General medicine" count="1 visit" color="peach" />
                  </div>
                  <div className="follow-up-nudge"><span className="nudge-icon"><CalendarCheck size={18} /></span><div><strong>2 follow-ups need attention</strong><p>One is due today, one still needs an invitation.</p><button onClick={() => navigate("follow-ups")}>Review follow-ups <ArrowRight size={13} /></button></div></div>
                </aside>
              </div>
            </>
          )}

          {section === "patients" && (
            <section className="panel page-panel">
              <div className="panel-heading patients-toolbar"><div><h2>Patient directory</h2><p>{patients.length} sample patient records</p></div><SearchBox value={search} onChange={setSearch} placeholder="Search name or phone" /></div>
              <PatientTable patients={filteredPatients} onOpen={(patient) => notify(`${patient.name} · ${patient.phone} · History is sample data only.`)} />
            </section>
          )}

          {section === "queue" && (
            <div className="queue-layout">
              <div className="queue-summary"><span className="queue-icon"><Stethoscope size={19} /></span><div><strong>Dr. Aditi Rao</strong><small>Cardiology · 3 patients on your schedule</small></div><span className="queue-date"><CalendarDays size={15} /> Mon, 26 Oct</span></div>
              <div className="queue-list">
                {appointments.filter((item) => item.doctor === "Dr. Aditi Rao").map((appointment, index) => (
                  <QueueCard key={appointment.id} appointment={appointment} position={index + 1} onAdvance={() => advanceAppointment(appointment.id)} onConsult={() => startConsultation(appointment)} />
                ))}
              </div>
              <div className="doctor-note"><ShieldCheck size={16} /><p><strong>Clinical privacy</strong><span>Only records for your assigned clinic and patient visits are shown. Sample notes below are fictional.</span></p></div>
            </div>
          )}

          {section === "follow-ups" && (
            <div className="followups-page">
              <div className="followup-stats"><div><span>Due today</span><strong>1</strong></div><div><span>Upcoming</span><strong>2</strong></div><div><span>Unbooked · 7+ days</span><strong>0</strong></div></div>
              <section className="panel page-panel">
                <div className="panel-heading"><div><h2>Follow-up tracker</h2><p>Internal reasons are never included in patient-facing reminders.</p></div><button className="button button-outline button-small" onClick={() => notify("Follow-up CSV export is not available in the simulator.")}>Export list</button></div>
                <div className="followup-list">{starterFollowUps.map((item) => <FollowUpCard key={item.name} item={item} onBook={() => { setShowAppointmentDialog(true); }} onInvite={() => notify("Simulator only — no WhatsApp reminder was sent.")} />)}</div>
              </section>
            </div>
          )}

          {section === "whatsapp" && (
            <div className="inbox-layout">
              <section className="inbox-list">
                <div className="inbox-list-heading"><div><h2>Conversations</h2><span className="inbox-count">4 active</span></div><button className="icon-button" aria-label="Search conversations" onClick={() => notify("Search is available in the production inbox.")}><Search size={17} /></button></div>
                <label className="inbox-search"><Search size={16} /><input placeholder="Search conversations" aria-label="Search conversations" /></label>
                <div className="inbox-filters"><button className="selected">All <span>4</span></button><button>Unread <span>3</span></button></div>
                {conversations.map((chat, index) => <button key={chat.phone} className={`conversation-row ${selectedChat === index ? "selected" : ""}`} onClick={() => { setSelectedChat(index); setHandover(false); }}>
                  <span className={`chat-avatar ${chat.color}`}>{chat.initials}</span><span className="conversation-copy"><strong>{chat.name}</strong><small>{chat.preview}</small></span><span className="conversation-meta"><small>{chat.time}</small>{chat.unread > 0 && <i>{chat.unread}</i>}</span>
                </button>)}
                <div className="simulator-label">DEVELOPMENT SIMULATOR · NOT WHATSAPP</div>
              </section>
              <section className="chat-panel">
                <div className="chat-header"><span className={`chat-avatar ${conversations[selectedChat].color}`}>{conversations[selectedChat].initials}</span><div><strong>{conversations[selectedChat].name}</strong><small>{conversations[selectedChat].phone}</small></div><button className="button button-outline button-small" onClick={() => setHandover((value) => !value)}>{handover ? "Return to bot" : "Take over"}</button><button className="icon-button" aria-label="More conversation options"><MoreHorizontal size={19} /></button></div>
                {handover && <div className="handover-banner"><UserRound size={15} /> Human handover is active. The bot is paused for this conversation.</div>}
                <div className="chat-date"><span>Today · 26 October</span></div>
                <div className="message incoming"><p>Hi, I have an appointment at the clinic. Could I move it to Friday?</p><span>10:34 AM</span></div>
                <div className="message outgoing"><p>Hi Priya! I can help with that. What time on Friday would work best for you?</p><span>10:35 AM <CheckCheck size={13} /></span></div>
                <div className="message incoming"><p>Could I come in the morning, around 10?</p><span>10:37 AM</span></div>
                <div className="chat-context-note"><ShieldCheck size={14} /> Sample conversation · Replies are not sent to WhatsApp.</div>
                <form className="message-composer" onSubmit={(event) => { event.preventDefault(); notify("Simulator only — the message was not sent."); }}>
                  <input placeholder={handover ? "Reply as reception…" : "Type a reply…"} aria-label="Message text" />
                  <button type="button" className="composer-quick" onClick={() => notify("Quick replies can be configured in the live inbox.")}>+</button>
                  <button type="submit" className="send-button" aria-label="Send message"><Send size={16} /></button>
                </form>
              </section>
              <aside className="patient-context">
                <div className="context-heading"><h2>Patient context</h2><button className="icon-button" aria-label="More patient actions"><MoreHorizontal size={18} /></button></div>
                <div className="context-patient"><span className="chat-avatar lavender">PN</span><strong>Priya Nair</strong><small>Sample patient · not verified</small><button className="button button-outline button-small" onClick={() => notify("Identity verification and appointment details are not active in demo mode.")}>Verify identity</button></div>
                <div className="context-section"><p className="context-label">CONTACT</p><div className="context-detail"><span>Phone</span><strong>+91 98670 12345</strong></div></div>
                <div className="context-section"><p className="context-label">NEXT APPOINTMENT</p><div className="appointment-context"><CalendarDays size={16} /><div><strong>Cardiology · Follow-up</strong><small>Today, 10:30 AM · Dr. Aditi Rao</small></div><span className="context-status">Booked</span></div></div>
                <div className="context-section"><p className="context-label">CONVERSATION</p><div className="context-detail"><span>Assigned to</span><strong>{handover ? "Maya Reddy" : "DocDesk assistant"}</strong></div><button className="context-action" onClick={() => notify("This conversation is sample data only.")}>View patient record <ArrowRight size={14} /></button></div>
              </aside>
            </div>
          )}
          <footer className="app-footer"><span>DocDesk <span>·</span> Clinic operations, made calmer.</span><span><ShieldCheck size={13} /> This workspace is a local development simulator.</span></footer>
        </div>
      </main>

      {showPatientDialog && <NewPatientDialog onClose={() => setShowPatientDialog(false)} onSave={addPatient} />}
      {showAppointmentDialog && <NewAppointmentDialog patients={patients} onClose={() => setShowAppointmentDialog(false)} onSave={addAppointment} />}
      {consulting && (
        <div className="consultation-backdrop">
          <section className="consultation-sheet" role="dialog" aria-modal="true" aria-labelledby="consult-title">
            <header className="consultation-header"><button className="icon-button" onClick={() => setConsulting(null)} aria-label="Close consultation"><ArrowLeft size={18} /></button><div><p className="eyebrow">CONSULTATION · {consulting.reference}</p><h2 id="consult-title">{consulting.patient}</h2><span>{consulting.department} · {formatTime(consulting.time)} · Sample record</span></div><button className="icon-button" onClick={() => setConsulting(null)} aria-label="Close"><X size={18} /></button></header>
            <div className="consultation-content">
              <aside className="consultation-history"><p className="context-label">PATIENT OVERVIEW</p><div className="history-detail"><span>Phone</span><strong>{consulting.phone}</strong></div><div className="history-detail"><span>Age</span><strong>34 years</strong></div><div className="history-detail"><span>Previous visit</span><strong>18 Oct 2026 · Cardiology</strong></div><div className="history-note"><FileText size={15} /><p>Sample history only. Connect a verified clinic account to view authorized records.</p></div></aside>
              <div className="consultation-editor"><div className="editor-heading"><div><h3>Visit note</h3><p>Clinical documentation · visible only to authorized care team</p></div><span className="draft-indicator"><i /> Unsaved draft</span></div><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record the consultation, observations and plan…" rows={7} />
                <div className="editor-field"><span className="field-title">Visit outcome</span><div className="choice-row">{["Stable", "Improving", "Referred", "Discharged"].map((item) => <button type="button" key={item} className={`choice-chip ${outcome === item ? "selected" : ""}`} onClick={() => setOutcome(item)}>{item}</button>)}</div></div>
                <div className="editor-field"><span className="field-title">Needs another visit?</span><div className="choice-row"><button type="button" className={`choice-chip ${needsFollowUp ? "selected" : ""}`} onClick={() => setNeedsFollowUp(true)}>Yes</button><button type="button" className={`choice-chip ${!needsFollowUp ? "selected" : ""}`} onClick={() => setNeedsFollowUp(false)}>No</button></div></div>
                {needsFollowUp && <div className="followup-editor">
                  <div className="editor-field"><span className="field-title">When?</span><div className="choice-row">{[7, 14, 28, 90].map((days) => <button key={days} type="button" className="choice-chip" onClick={() => { const date = new Date("2026-10-26T00:00:00"); date.setDate(date.getDate() + days); setFollowUpDate(date.toISOString().slice(0, 10)); }}>{days === 90 ? "3 months" : `${days / 7} ${days === 7 ? "week" : "weeks"}`}</button>)}</div><label className="custom-date">Custom date<input type="date" value={followUpDate} min="2026-10-26" onChange={(event) => setFollowUpDate(event.target.value)} /></label></div>
                  <div className="editor-field"><span className="field-title">Type</span><div className="choice-row"><button type="button" className={`choice-chip ${followUpType === "Follow-up" ? "selected" : ""}`} onClick={() => setFollowUpType("Follow-up")}>Follow-up</button><button type="button" className={`choice-chip ${followUpType === "Revision" ? "selected" : ""}`} onClick={() => setFollowUpType("Revision")}>Revision</button></div></div>
                  <label className="internal-reason">Reason <span>(internal, not sent to patient)</span><input value={internalReason} onChange={(event) => { setInternalReason(event.target.value); const preview = event.target.value ? `Dr. Aditi Rao would like to see you again on ${new Date(followUpDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} for a ${followUpType.toLowerCase()}.` : ""; setPatientFacingPreview(preview); }} placeholder="e.g. Review blood pressure" /></label>
                  <div className="message-preview"><MessageCircle size={15} /><p><strong>Patient message preview · simulator</strong><span>{patientFacingPreview || `Dr. Aditi Rao would like to see you again on ${new Date(followUpDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} for a ${followUpType.toLowerCase()}.`}</span></p></div>
                </div>}
              </div>
            </div>
            <footer className="consultation-actions"><button className="button button-quiet" onClick={() => saveConsultation(false)}>Save draft</button><button className="button button-primary" onClick={() => saveConsultation(true)}>Confirm &amp; complete visit <ArrowRight size={15} /></button></footer>
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    </div>
  );
}

function Metric({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: React.ReactNode; tone: string }) {
  return <article className="metric-card"><span className={`metric-icon ${tone}`}>{icon}</span><span className="metric-label">{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function AppointmentRow({ appointment, onAdvance, onConsult }: { appointment: Appointment; onAdvance: () => void; onConsult: () => void }) {
  const action = appointment.status === "Booked" ? "Check in" : appointment.status === "Arrived" ? "Start visit" : appointment.status === "In consultation" ? "Open note" : "Completed";
  return <article className="appointment-row"><div className="appointment-time"><strong>{formatTime(appointment.time)}</strong><span>30 min</span></div><span className={`patient-avatar avatar-${appointment.patient.charCodeAt(0) % 4}`}>{appointment.patient.split(" ").map((name) => name[0]).join("")}</span><div className="appointment-patient"><strong>{appointment.patient}</strong><span>{appointment.type} <i /> {appointment.reference}</span></div><div className="appointment-doctor"><span>{appointment.doctor}</span><small>{appointment.department}</small></div><StatusPill status={appointment.status} /><button className={`appointment-action ${appointment.status === "In consultation" ? "highlight" : ""}`} onClick={appointment.status === "Arrived" || appointment.status === "In consultation" ? onConsult : onAdvance} disabled={appointment.status === "Completed"}>{action}{appointment.status !== "Completed" && <ArrowRight size={13} />}</button></article>;
}

function DepartmentRow({ name, count, color }: { name: string; count: string; color: string }) {
  return <div className="department-row"><span className={`department-dot ${color}`} /><span>{name}</span><strong>{count}</strong></div>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><Search size={22} /><strong>{title}</strong><span>{detail}</span></div>;
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="search-box"><Search size={16} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /><kbd>⌘ K</kbd></label>;
}

function PatientTable({ patients, onOpen }: { patients: Patient[]; onOpen: (patient: Patient) => void }) {
  return <div className="table-wrap"><table className="patient-table"><thead><tr><th>Patient</th><th>Phone number</th><th>Age</th><th>Last visit</th><th>Next appointment</th><th /></tr></thead><tbody>{patients.map((patient, index) => <tr key={patient.phone} onClick={() => onOpen(patient)}><td><span className={`patient-avatar avatar-${index % 4}`}>{patient.name.split(" ").map((name) => name[0]).join("")}</span><strong>{patient.name}</strong></td><td>{patient.phone}</td><td>{patient.age}</td><td>{patient.lastVisit}</td><td>{patient.nextVisit}</td><td><button aria-label={`View ${patient.name}`} className="icon-button" onClick={(event) => { event.stopPropagation(); onOpen(patient); }}><ArrowRight size={15} /></button></td></tr>)}</tbody></table>{patients.length === 0 && <EmptyState title="No patients found" detail="Try a different name or phone number." />}</div>;
}

function QueueCard({ appointment, position, onAdvance, onConsult }: { appointment: Appointment; position: number; onAdvance: () => void; onConsult: () => void }) {
  return <article className={`queue-card ${appointment.status === "In consultation" ? "currently-seeing" : ""}`}><div className="queue-position"><span>{String(position).padStart(2, "0")}</span><i /></div><div className="queue-time"><strong>{formatTime(appointment.time)}</strong><small>30 minutes</small></div><span className={`patient-avatar avatar-${position % 4}`}>{appointment.patient.split(" ").map((name) => name[0]).join("")}</span><div className="queue-patient"><strong>{appointment.patient}</strong><span>{appointment.type} <i /> {appointment.reference}</span><small>{appointment.department}</small></div><StatusPill status={appointment.status} /><div className="queue-actions">{appointment.status === "Booked" && <button className="button button-outline button-small" onClick={onAdvance}>Mark arrived</button>}{appointment.status === "Arrived" && <button className="button button-primary button-small" onClick={onConsult}>Start visit</button>}{appointment.status === "In consultation" && <button className="button button-primary button-small" onClick={onConsult}>Open note <ArrowRight size={13} /></button>}{appointment.status === "Completed" && <span className="completed-label"><Check size={14} /> Done</span>}</div></article>;
}

function FollowUpCard({ item, onBook, onInvite }: { item: (typeof starterFollowUps)[number]; onBook: () => void; onInvite: () => void }) {
  const isBooked = item.status === "Booked";
  return <article className="followup-row"><span className="followup-calendar"><CalendarCheck size={18} /></span><div className="followup-patient"><strong>{item.name}</strong><span>{item.department} <i /> {item.doctor}</span></div><div className="followup-reason"><span>{item.kind} · {item.when}</span><small>Internal reason: {item.reason}</small></div><span className={`followup-state ${isBooked ? "booked" : item.status === "Due today" ? "due" : ""}`}><i />{item.status}</span><div className="followup-actions">{!isBooked && <><button className="button button-outline button-small" onClick={onBook}>Book visit</button><button className="button button-quiet button-small" onClick={onInvite}>Send reminder</button></>}</div></article>;
}
