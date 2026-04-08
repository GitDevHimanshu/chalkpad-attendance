require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT;
const MONGO_URI = process.env.MONGO_URI;

app.use(cors());
app.use(express.json());

// ── Schema ──────────────────────────────────────────────────
const sessionSchema = new mongoose.Schema(
  {
    teacherId: { type: String, default: 'default' },  // ← NEW
    submittedAt: { type: Date, default: Date.now },
    date: { type: String, default: '' },
    class: { type: String, default: '' },
    subject: { type: String, default: '' },
    group: { type: String, default: '' },
    periods: { type: [Number], default: [] },
    timeTable: { type: String, default: '' },
    periodSlot: { type: String, default: '' },
    totalStudents: { type: Number, default: 0 },
    presentCount: { type: Number, default: 0 },
    absentRolls: { type: [String], default: [] },
    allStudents: [
      {
        roll: String,
        name: String,
        status: { type: String, enum: ['P', 'A'] }
      }
    ]
  },
  { timestamps: true }
);

const Session = mongoose.model('Session', sessionSchema);

// ── Routes ──────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Haziri Server is running' });
});

// POST — save a session (called by the browser extension)
app.post('/api/session', async (req, res) => {
  try {
    const { config, totalStudents, presentCount, absentRolls, allStudents, submittedAt, teacherId } = req.body;
    const info = config?.info || {};

    const session = new Session({
      teacherId: teacherId || 'default',          // ← NEW
      submittedAt: submittedAt ? new Date(submittedAt) : new Date(),
      date: info.date || '',
      class: info.class || '',
      subject: info.subject || '',
      group: info.group || '',
      periods: info.period || [],
      timeTable: info.timeTable || '',
      periodSlot: info.periodSlot || '',
      totalStudents: totalStudents ?? 0,
      presentCount: presentCount ?? 0,
      absentRolls: absentRolls || [],
      allStudents: allStudents || []
    });

    await session.save();
    res.status(201).json({ success: true, id: session._id });
  } catch (err) {
    console.error('Save error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET — sessions filtered by teacherId
app.get('/api/sessions', async (req, res) => {
  try {
    const { page = 1, limit = 1000, search = '', teacherId = 'default' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const baseFilter = { teacherId };                 // ← filter by teacher

    const filter = search
      ? {
        ...baseFilter,
        $or: [
          { group: { $regex: search, $options: 'i' } },
          { subject: { $regex: search, $options: 'i' } },
          { date: { $regex: search, $options: 'i' } },
          { class: { $regex: search, $options: 'i' } }
        ]
      }
      : baseFilter;

    const [sessions, total] = await Promise.all([
      Session.find(filter).sort({ submittedAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      Session.countDocuments(filter)
    ]);

    res.json({ sessions, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET — single session by ID
app.get('/api/sessions/:id', async (req, res) => {
  try {
    const session = await Session.findById(req.params.id).lean();
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET — stats filtered by teacherId
app.get('/api/stats', async (req, res) => {
  try {
    const { teacherId = 'default' } = req.query;     // ← filter by teacher
    const filter = { teacherId };

    const total = await Session.countDocuments(filter);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayCount = await Session.countDocuments({ ...filter, submittedAt: { $gte: today } });

    const agg = await Session.aggregate([
      { $match: filter },
      { $group: { _id: null, totalStudents: { $sum: '$totalStudents' }, totalPresent: { $sum: '$presentCount' } } }
    ]);

    const sums = agg[0] || { totalStudents: 0, totalPresent: 0 };
    res.json({
      totalSessions: total,
      todaySessions: todayCount,
      totalStudents: sums.totalStudents,
      totalPresent: sums.totalPresent,
      totalAbsent: sums.totalStudents - sums.totalPresent
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE — remove a session by ID
app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await Session.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Connect & Start ─────────────────────────────────────────
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('✅  MongoDB connected →', MONGO_URI);
    app.listen(PORT, () => console.log(`🚀  Server running → http://localhost:${PORT}`));
  })
  .catch(err => { console.error('❌  MongoDB connection failed:', err.message); process.exit(1); });
