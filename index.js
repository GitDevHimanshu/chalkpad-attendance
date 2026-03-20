require('dotenv').config();
const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
require('dotenv').config();

const app       = express();
const PORT      = process.env.PORT      || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/attendance';

// ── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Schema ──────────────────────────────────────────────────
const sessionSchema = new mongoose.Schema(
  {
    submittedAt:   { type: Date,     default: Date.now },
    date:          { type: String,   default: '' },
    class:         { type: String,   default: '' },
    subject:       { type: String,   default: '' },
    group:         { type: String,   default: '' },
    periods:       { type: [Number], default: [] },
    timeTable:     { type: String,   default: '' },
    periodSlot:    { type: String,   default: '' },
    totalStudents: { type: Number,   default: 0 },
    presentCount:  { type: Number,   default: 0 },
    absentRolls:   { type: [String], default: [] },
    allStudents: [
      {
        roll:   String,
        name:   String,
        status: { type: String, enum: ['P', 'A'] }
      }
    ]
  },
  { timestamps: true }
);

const Session = mongoose.model('Session', sessionSchema);

// ── Routes ──────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Chalkpad Attendance Server is running' });
});

// POST — save a session (called by the browser extension)
app.post('/api/session', async (req, res) => {
  try {
    const {
      config,
      totalStudents,
      presentCount,
      absentRolls,
      allStudents,
      submittedAt
    } = req.body;

    const info = config?.info || {};

    const session = new Session({
      submittedAt:   submittedAt ? new Date(submittedAt) : new Date(),
      date:          info.date       || '',
      class:         info.class      || '',
      subject:       info.subject    || '',
      group:         info.group      || '',
      periods:       info.period     || [],
      timeTable:     info.timeTable  || '',
      periodSlot:    info.periodSlot || '',
      totalStudents: totalStudents   ?? 0,
      presentCount:  presentCount    ?? 0,
      absentRolls:   absentRolls     || [],
      allStudents:   allStudents     || []
    });

    await session.save();
    res.status(201).json({ success: true, id: session._id });
  } catch (err) {
    console.error('Save error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET — all sessions with optional search + pagination (used by mobile app)
app.get('/api/sessions', async (req, res) => {
  try {
    const { page = 1, limit = 30, search = '' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = search
      ? {
          $or: [
            { group:   { $regex: search, $options: 'i' } },
            { subject: { $regex: search, $options: 'i' } },
            { date:    { $regex: search, $options: 'i' } },
            { class:   { $regex: search, $options: 'i' } }
          ]
        }
      : {};

    const [sessions, total] = await Promise.all([
      Session.find(filter)
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Session.countDocuments(filter)
    ]);

    res.json({
      sessions,
      total,
      page:  parseInt(page),
      limit: parseInt(limit)
    });
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

// GET — summary stats for mobile dashboard
app.get('/api/stats', async (req, res) => {
  try {
    const total = await Session.countDocuments();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayCount = await Session.countDocuments({
      submittedAt: { $gte: today }
    });

    const agg = await Session.aggregate([
      {
        $group: {
          _id:          null,
          totalStudents: { $sum: '$totalStudents' },
          totalPresent:  { $sum: '$presentCount' }
        }
      }
    ]);

    const sums = agg[0] || { totalStudents: 0, totalPresent: 0 };

    res.json({
      totalSessions: total,
      todaySessions: todayCount,
      totalStudents: sums.totalStudents,
      totalPresent:  sums.totalPresent,
      totalAbsent:   sums.totalStudents - sums.totalPresent
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
mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('✅  MongoDB connected →', MONGO_URI);
    app.listen(PORT, () => {
      console.log(`🚀  Server running  →  http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌  MongoDB connection failed:', err.message);
    process.exit(1);
  });
