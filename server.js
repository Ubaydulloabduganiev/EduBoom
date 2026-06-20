require("dotenv").config();

const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing. Add PostgreSQL database URL in Render environment variables.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new PgSession({
    pool,
    tableName: "session"
  }),
  secret: process.env.SESSION_SECRET || "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

app.use(express.static(path.join(__dirname, "public")));

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Login required" });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: "Login required" });
    if (!roles.includes(req.session.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

async function q(text, params) {
  return pool.query(text, params);
}

async function initDb() {
  await q(`CREATE TABLE IF NOT EXISTS centers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await q(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    center_id INTEGER REFERENCES centers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner','manager','receptionist','teacher','accountant')),
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await q(`CREATE TABLE IF NOT EXISTS teachers (
    id SERIAL PRIMARY KEY,
    center_id INTEGER REFERENCES centers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    specialization TEXT,
    percentage NUMERIC DEFAULT 40,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await q(`CREATE TABLE IF NOT EXISTS courses (
    id SERIAL PRIMARY KEY,
    center_id INTEGER REFERENCES centers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    payment_type TEXT NOT NULL CHECK(payment_type IN ('monthly','per_lesson')),
    price INTEGER NOT NULL DEFAULT 0,
    duration TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await q(`CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    center_id INTEGER REFERENCES centers(id) ON DELETE CASCADE,
    course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    schedule TEXT,
    room TEXT,
    level TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await q(`CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    center_id INTEGER REFERENCES centers(id) ON DELETE CASCADE,
    group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    phone TEXT,
    parent_phone TEXT,
    age INTEGER,
    level TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    balance INTEGER DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await q(`CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY,
    center_id INTEGER REFERENCES centers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    age INTEGER,
    course_interest TEXT,
    source TEXT,
    status TEXT NOT NULL DEFAULT 'received',
    note TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await q(`CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    center_id INTEGER REFERENCES centers(id) ON DELETE CASCADE,
    student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
    group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
    amount INTEGER NOT NULL,
    method TEXT NOT NULL DEFAULT 'cash',
    paid_at DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await q(`CREATE TABLE IF NOT EXISTS attendance (
    id SERIAL PRIMARY KEY,
    center_id INTEGER REFERENCES centers(id) ON DELETE CASCADE,
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('present','absent','late','excused')),
    attended_at DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(student_id, group_id, attended_at)
  )`);

  if ((process.env.DEMO_SEED || "true") === "true") {
    await seedDemo();
  }
}

const firstNames = ["Aziz","Madina","Ali","Jasur","Diyor","Sardor","Zarina","Kamola","Bekzod","Malika","Shahzod","Iroda","Asadbek","Nodira","Timur","Saida","Abdulaziz","Muslima","Otabek","Dilnoza","Javohir","Munisa","Sherzod","Sevara","Umid","Rayhona","Farruh","Madinabonu","Oybek","Gulnoza"];
const lastNames = ["Karimov","Sobirova","Tursunov","Olimov","Abdullayev","Rahimova","Yuldashev","Qodirova","Usmonov","Ergasheva","Ismoilov","Nazarova","Xolmatov","Mamatqulova","Rustamov","Saidova","Aliyev","Akbarova","Mirzayev","Hasanova"];

function randomName(i) {
  return `${firstNames[i % firstNames.length]} ${lastNames[(i * 7) % lastNames.length]}`;
}
function phone(i) {
  return "+9989" + String(10000000 + i * 7411).slice(0, 8);
}

async function seedDemo() {
  const existing = await q("SELECT id FROM centers WHERE name=$1", ["Kevin's Academy"]);
  if (existing.rows.length) return;

  const center = await q("INSERT INTO centers(name) VALUES($1) RETURNING id", ["Kevin's Academy"]);
  const centerId = center.rows[0].id;

  const password = await bcrypt.hash("Kevin2026!", 10);
  const users = [
    ["Kevin Owner", "owner@kevins.demo", "owner"],
    ["Kevin Manager", "manager@kevins.demo", "manager"],
    ["Kevin Reception", "reception@kevins.demo", "receptionist"],
    ["Kevin Teacher", "teacher@kevins.demo", "teacher"],
    ["Kevin Accountant", "accountant@kevins.demo", "accountant"]
  ];
  for (const u of users) {
    await q("INSERT INTO users(center_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)", [centerId, u[0], u[1], password, u[2]]);
  }

  const teacherRows = [
    ["Aziz Teacher", "+998901112233", "General English / ESL", 42],
    ["Madina Teacher", "+998902223344", "Kids ESL / Speaking", 40],
    ["Kevin Teacher", "+998903334455", "IELTS", 50],
    ["Dilshod Teacher", "+998904445566", "CEFR", 45],
    ["Nodira Teacher", "+998905556677", "Grammar / ESL", 38],
    ["Sardor Teacher", "+998906667788", "IELTS Speaking", 48],
    ["Sevara Teacher", "+998907778899", "CEFR Writing", 43],
    ["Timur Teacher", "+998908889900", "Foundation ESL", 37]
  ];
  const teacherIds = [];
  for (const t of teacherRows) {
    const r = await q("INSERT INTO teachers(center_id,name,phone,specialization,percentage) VALUES($1,$2,$3,$4,$5) RETURNING id", [centerId, ...t]);
    teacherIds.push(r.rows[0].id);
  }

  const courseRows = [
    ["ESL General English", "ESL", "monthly", 450000, "6 months per level"],
    ["IELTS Preparation", "IELTS", "monthly", 650000, "4 months"],
    ["CEFR Preparation", "CEFR", "monthly", 550000, "3 months"],
    ["Speaking Club", "ESL", "per_lesson", 60000, "Open"]
  ];
  const courseIds = [];
  for (const c of courseRows) {
    const r = await q("INSERT INTO courses(center_id,name,type,payment_type,price,duration) VALUES($1,$2,$3,$4,$5,$6) RETURNING id", [centerId, ...c]);
    courseIds.push(r.rows[0].id);
  }

  const groupRows = [
    ["ESL A1 Morning", 0, 0, "Mon/Wed/Fri 09:00", "101", "A1"],
    ["ESL A2 Afternoon", 0, 1, "Mon/Wed/Fri 15:00", "102", "A2"],
    ["ESL B1 Evening", 0, 4, "Tue/Thu/Sat 18:00", "103", "B1"],
    ["ESL Starter Kids", 0, 7, "Mon/Wed/Fri 16:00", "104", "Starter"],
    ["IELTS 5.5+", 1, 2, "Tue/Thu/Sat 17:00", "201", "5.5"],
    ["IELTS 6.5+", 1, 5, "Mon/Wed/Fri 18:30", "202", "6.5"],
    ["IELTS Intensive", 1, 2, "Daily 19:00", "203", "Intensive"],
    ["CEFR B1", 2, 3, "Tue/Thu/Sat 10:00", "301", "B1"],
    ["CEFR B2", 2, 6, "Mon/Wed/Fri 11:00", "302", "B2"],
    ["CEFR Fast Track", 2, 3, "Tue/Thu/Sat 16:00", "303", "Fast"],
    ["Speaking Club A2-B1", 3, 1, "Friday 17:00", "105", "A2-B1"],
    ["Speaking Club B2+", 3, 5, "Saturday 15:00", "106", "B2+"]
  ];
  const groupIds = [];
  for (const g of groupRows) {
    const r = await q("INSERT INTO groups(center_id,name,course_id,teacher_id,schedule,room,level) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id", [centerId, g[0], courseIds[g[1]], teacherIds[g[2]], g[3], g[4], g[5]]);
    groupIds.push(r.rows[0].id);
  }

  const groupDistribution = [
    ...Array(18).fill(0), ...Array(18).fill(1), ...Array(20).fill(2), ...Array(18).fill(3), ...Array(12).fill(10), ...Array(6).fill(11),
    ...Array(14).fill(4), ...Array(12).fill(5), ...Array(12).fill(6),
    ...Array(8).fill(7), ...Array(7).fill(8), ...Array(5).fill(9)
  ];

  const studentIds = [];
  for (let i = 0; i < 150; i++) {
    const groupIndex = groupDistribution[i];
    const status = i % 23 === 0 ? "trial" : i % 37 === 0 ? "frozen" : "active";
    const debt = i % 4 === 0 ? [150000, 250000, 350000, 450000, 650000][i % 5] : 0;
    const levels = ["Beginner", "A1", "A2", "B1", "B2", "5.5", "6.0", "6.5"];
    const note = debt > 0 ? "Payment follow-up needed" : (i % 11 === 0 ? "Absent recently" : "");
    const r = await q(`INSERT INTO students(center_id,group_id,name,phone,parent_phone,age,level,status,balance,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [centerId, groupIds[groupIndex], randomName(i), phone(i), phone(i+300), 11 + (i % 18), levels[i % levels.length], status, debt, note]);
    studentIds.push({ id: r.rows[0].id, groupIndex, debt });
  }

  for (let i = 0; i < 114; i++) {
    const s = studentIds[i];
    const group = groupRows[s.groupIndex];
    const teacherId = teacherIds[group[2]];
    const amount = group[1] === 1 ? 650000 : group[1] === 2 ? 550000 : group[1] === 3 ? 60000 : 450000;
    const methods = ["cash", "card", "click", "payme"];
    await q("INSERT INTO payments(center_id,student_id,group_id,teacher_id,amount,method,paid_at) VALUES($1,$2,$3,$4,$5,$6,CURRENT_DATE - ($7 || ' days')::interval)",
      [centerId, s.id, groupIds[s.groupIndex], teacherId, amount, methods[i % methods.length], i % 28]);
  }

  const leadStatuses = ["received","trial","enrolled","first_payment"];
  const sources = ["Instagram","Telegram","Walk-in","Referral","Website","Google"];
  for (let i = 0; i < 96; i++) {
    const courseInterest = i % 5 === 0 ? "CEFR Preparation" : i % 3 === 0 ? "IELTS Preparation" : "ESL General English";
    await q(`INSERT INTO leads(center_id,name,phone,age,course_interest,source,status,note,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW() - ($9 || ' days')::interval)`,
      [centerId, randomName(i+200), phone(i+600), 12 + (i % 18), courseInterest, sources[i % sources.length], leadStatuses[i % leadStatuses.length], "Demo lead", i % 45]);
  }

  for (let i = 0; i < 150; i++) {
    const s = studentIds[i];
    const status = i % 17 === 0 ? "absent" : i % 13 === 0 ? "late" : i % 19 === 0 ? "excused" : "present";
    await q(`INSERT INTO attendance(center_id,student_id,group_id,status,attended_at)
      VALUES($1,$2,$3,$4,CURRENT_DATE)
      ON CONFLICT(student_id,group_id,attended_at) DO NOTHING`, [centerId, s.id, groupIds[s.groupIndex], status]);
  }
}

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const result = await q("SELECT * FROM users WHERE email=$1", [String(email || "").toLowerCase().trim()]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
    return res.status(401).json({ error: "Wrong email or password" });
  }
  req.session.user = { id: user.id, centerId: user.center_id, name: user.name, email: user.email, role: user.role };
  res.json({ user: req.session.user });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.get("/api/bootstrap", requireLogin, async (req, res) => {
  const centerId = req.session.user.centerId;
  const [center, courses, teachers, groups] = await Promise.all([
    q("SELECT * FROM centers WHERE id=$1", [centerId]),
    q("SELECT * FROM courses WHERE center_id=$1 ORDER BY id", [centerId]),
    q("SELECT * FROM teachers WHERE center_id=$1 ORDER BY id", [centerId]),
    q("SELECT * FROM groups WHERE center_id=$1 ORDER BY id", [centerId])
  ]);
  res.json({ center: center.rows[0], courses: courses.rows, teachers: teachers.rows, groups: groups.rows });
});

app.get("/api/dashboard", requireLogin, async (req, res) => {
  const centerId = req.session.user.centerId;
  const active = await q("SELECT COUNT(*)::int AS count FROM students WHERE center_id=$1 AND status='active'", [centerId]);
  const students = await q("SELECT COUNT(*)::int AS count FROM students WHERE center_id=$1", [centerId]);
  const revenue = await q("SELECT COALESCE(SUM(amount),0)::int AS total FROM payments WHERE center_id=$1 AND paid_at >= date_trunc('month', CURRENT_DATE)", [centerId]);
  const debt = await q("SELECT COALESCE(SUM(balance),0)::int AS total FROM students WHERE center_id=$1", [centerId]);
  const leads = await q("SELECT status, COUNT(*)::int count FROM leads WHERE center_id=$1 GROUP BY status", [centerId]);
  const courseMix = await q(`SELECT c.type, COUNT(s.id)::int count
    FROM students s JOIN groups g ON s.group_id=g.id JOIN courses c ON g.course_id=c.id
    WHERE s.center_id=$1 GROUP BY c.type ORDER BY count DESC`, [centerId]);
  const recentPayments = await q(`SELECT p.*, s.name student_name, t.name teacher_name FROM payments p
    LEFT JOIN students s ON p.student_id=s.id LEFT JOIN teachers t ON p.teacher_id=t.id
    WHERE p.center_id=$1 ORDER BY p.created_at DESC LIMIT 8`, [centerId]);
  const attention = await q(`SELECT s.*, g.name group_name FROM students s LEFT JOIN groups g ON s.group_id=g.id
    WHERE s.center_id=$1 AND (s.balance > 0 OR LOWER(COALESCE(s.notes,'')) LIKE '%absent%')
    ORDER BY s.balance DESC LIMIT 10`, [centerId]);
  res.json({
    active: active.rows[0].count,
    students: students.rows[0].count,
    revenue: revenue.rows[0].total,
    debt: debt.rows[0].total,
    leads: leads.rows,
    courseMix: courseMix.rows,
    recentPayments: recentPayments.rows,
    attention: attention.rows
  });
});

app.get("/api/students", requireLogin, async (req, res) => {
  const centerId = req.session.user.centerId;
  const result = await q(`SELECT s.*, g.name group_name, c.name course_name, c.type course_type
    FROM students s
    LEFT JOIN groups g ON s.group_id=g.id
    LEFT JOIN courses c ON g.course_id=c.id
    WHERE s.center_id=$1
    ORDER BY s.id DESC`, [centerId]);
  res.json(result.rows);
});

app.post("/api/students", requireRole("owner","manager","receptionist"), async (req, res) => {
  const centerId = req.session.user.centerId;
  const b = req.body;
  const result = await q(`INSERT INTO students(center_id,group_id,name,phone,parent_phone,age,level,status,balance,notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [centerId, b.group_id || null, b.name, b.phone, b.parent_phone, b.age || null, b.level, b.status || "active", b.balance || 0, b.notes || ""]);
  res.json(result.rows[0]);
});

app.get("/api/leads", requireLogin, async (req, res) => {
  const result = await q("SELECT * FROM leads WHERE center_id=$1 ORDER BY created_at DESC", [req.session.user.centerId]);
  res.json(result.rows);
});

app.post("/api/leads", requireRole("owner","manager","receptionist"), async (req, res) => {
  const b = req.body;
  const result = await q(`INSERT INTO leads(center_id,name,phone,age,course_interest,source,status,note)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.session.user.centerId, b.name, b.phone, b.age || null, b.course_interest, b.source, b.status || "received", b.note || ""]);
  res.json(result.rows[0]);
});

app.patch("/api/leads/:id/status", requireRole("owner","manager","receptionist"), async (req, res) => {
  const result = await q("UPDATE leads SET status=$1 WHERE id=$2 AND center_id=$3 RETURNING *", [req.body.status, req.params.id, req.session.user.centerId]);
  res.json(result.rows[0]);
});

app.get("/api/payments", requireLogin, async (req, res) => {
  const result = await q(`SELECT p.*, s.name student_name, t.name teacher_name, g.name group_name
    FROM payments p
    LEFT JOIN students s ON p.student_id=s.id
    LEFT JOIN teachers t ON p.teacher_id=t.id
    LEFT JOIN groups g ON p.group_id=g.id
    WHERE p.center_id=$1 ORDER BY p.created_at DESC`, [req.session.user.centerId]);
  res.json(result.rows);
});

app.post("/api/payments", requireRole("owner","manager","receptionist","accountant"), async (req, res) => {
  const centerId = req.session.user.centerId;
  const b = req.body;
  const stu = await q(`SELECT s.*, g.teacher_id FROM students s LEFT JOIN groups g ON s.group_id=g.id WHERE s.id=$1 AND s.center_id=$2`, [b.student_id, centerId]);
  if (!stu.rows[0]) return res.status(404).json({ error: "Student not found" });
  const s = stu.rows[0];
  const amount = Number(b.amount || 0);
  const result = await q(`INSERT INTO payments(center_id,student_id,group_id,teacher_id,amount,method,paid_at)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [centerId, s.id, s.group_id, s.teacher_id, amount, b.method || "cash", b.paid_at || new Date().toISOString().slice(0,10)]);
  await q("UPDATE students SET balance=GREATEST(balance-$1,0) WHERE id=$2 AND center_id=$3", [amount, s.id, centerId]);
  res.json(result.rows[0]);
});

app.get("/api/teachers", requireLogin, async (req, res) => {
  const centerId = req.session.user.centerId;
  const result = await q(`SELECT t.*,
    COALESCE(SUM(p.amount),0)::int AS paid_by_students,
    ROUND(COALESCE(SUM(p.amount),0) * t.percentage / 100)::int AS salary,
    COUNT(DISTINCT s.id)::int AS student_count
    FROM teachers t
    LEFT JOIN payments p ON p.teacher_id=t.id
    LEFT JOIN groups g ON g.teacher_id=t.id
    LEFT JOIN students s ON s.group_id=g.id
    WHERE t.center_id=$1
    GROUP BY t.id
    ORDER BY t.id`, [centerId]);
  res.json(result.rows);
});

app.post("/api/attendance", requireRole("owner","manager","teacher"), async (req, res) => {
  const centerId = req.session.user.centerId;
  const { group_id, date, marks } = req.body;
  for (const m of marks || []) {
    await q(`INSERT INTO attendance(center_id,student_id,group_id,status,attended_at)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(student_id,group_id,attended_at) DO UPDATE SET status=EXCLUDED.status`,
      [centerId, m.student_id, group_id, m.status, date || new Date().toISOString().slice(0,10)]);
  }
  res.json({ ok: true });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

initDb()
  .then(() => app.listen(PORT, () => console.log(`EduBoom CRM running on port ${PORT}`)))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
