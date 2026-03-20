const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/attendance';

// ── Middleware ──────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── MongoDB Schema ──────────────────────────────────
const sessionSchema = new mongoose.Schema({
  submittedAt:   { type: Date, default: Date.now },
  date:          String,
  class:         String,
  subject:       String,
  group:         String,
  periods:       [Number],
  timeTable:     String,
  periodSlot:    String,
  totalStudents: Number,
  presentCount:  Number,
  absentRolls:   [String],
  allStudents: [{
    roll:   String,
    name:   String,
    status: { type: String, enum: ['P', 'A'] }
  }]
}, { timestamps: true });

const Session = mongoose.model('Session', sessionSchema);

// ── Routes ──────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Attendance server running' });
});

// Save session
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
      date:          info.date          || '',
      class:         info.class         || '',
      subject:       info.subject       || '',
      group:         info.group         || '',
      periods:       info.period        || [],
      timeTable:     info.timeTable     || '',
      periodSlot:    info.periodSlot    || '',
      totalStudents: totalStudents      ?? 0,
      presentCount:  presentCount       ?? 0,
      absentRolls:   absentRolls        || [],
      allStudents:   allStudents        || []
    });

    await session.save();
    res.status(201).json({ success: true, id: session._id });
  } catch (err) {
    console.error('Save error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all sessions (newest first)
app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await Session.find()
      .sort({ submittedAt: -1 })
      .limit(200)
      .lean();
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Connect & Start ─────────────────────────────────
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log(`✅ MongoDB connected: ${MONGO_URI}`);
    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });
