const fs = require('fs');


// Helpers
function isDay(text) {
  const days = [
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
    'mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'
  ];
  const normalized = text.toLowerCase().replace(/[^a-z]/g, '');
  return days.includes(normalized);
}

function isTimeRange(text) {
  const timePart = '(\\d{1,2}:\\d{2}|\\d{1,2}|\\d{3,4})';
  const pattern = new RegExp(`^${timePart}\\s*-\\s*${timePart}$`);
  return pattern.test(text.trim());
}

function normalizeDay(raw) {
  const lower = raw.trim().toLowerCase();
  if (lower.startsWith('mo')) return 'Monday';
  if (lower.startsWith('tu')) return 'Tuesday';
  if (lower.startsWith('we')) return 'Wednesday';
  if (lower.startsWith('th')) return 'Thursday';
  if (lower.startsWith('fr')) return 'Friday';
  if (lower.startsWith('sa')) return 'Saturday';
  if (lower.startsWith('su')) return 'Sunday';
  return raw;
}

function parseFuzzyTime(raw) {
  if (!raw) return null;
  const val = parseInt(raw, 10);
  if (isNaN(val)) return null;
  
  let h = 0;
  let m = 0;
  
  if (raw.length >= 3) {
    m = val % 100;
    h = Math.floor(val / 100);
  } else {
    h = val;
    m = 0;
  }
  
  return new Date(2024, 0, 1, h, m);
}

function parseTimeRange(text) {
  const clean = text.replace(/[^0-9\-]/g, '');
  const parts = clean.split('-');
  if (parts.length !== 2) return null;

  const start = parseFuzzyTime(parts[0]);
  const end = parseFuzzyTime(parts[1]);
  
  if (start && end) {
    const sH = start.getHours() + (start.getHours() < 7 ? 12 : 0);
    const eH = end.getHours() + (end.getHours() < 7 ? 12 : 0);
    
    // We'll mock a generic "today" date for the times, but the frontend really just needs strings or ISO strings.
    const now = new Date();
    const startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sH, start.getMinutes());
    const endTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eH, end.getMinutes());
    
    return { start: startTime, end: endTime };
  }
  return null;
}

function parseCellContent(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let batch = "";
  let room = "";
  let subject = "";
  let group = null;
  
  for (let line of lines) {
    if (line.includes("Group")) {
      group = line;
    } else if (line.includes("-") && !line.includes(" ")) {
      batch = line;
    } else {
      const roomMatch = line.match(/\b([A-Z]{1,4}\d{1,4}R?)\b/);
      if (roomMatch) {
        room = roomMatch[0];
        subject = line.substring(0, roomMatch.index).trim();
        
        if (!subject && roomMatch.index + roomMatch[0].length < line.length) {
          subject = line.substring(roomMatch.index + roomMatch[0].length).trim();
        }
      } else {
        subject = `${subject} ${line}`.trim();
      }
    }
  }
  
  return { subject, room, batch, group };
}

async function extractTimetable(buffer, trainerName) {
  // Dynamically import pdfjs-dist since it is an ES module
  const pdfjsLib = await import('pdfjs-dist');
  
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const entries = [];
  
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });
    const pageHeight = viewport.height;
    
    const lines = textContent.items.map(item => {
      // transform: [scaleX, skewY, skewX, scaleY, translateX, translateY]
      const tx = item.transform;
      const x = tx[4];
      const y = pageHeight - tx[5]; // Invert Y so 0 is top
      const width = item.width;
      const height = item.height;
      return {
        text: item.str,
        bounds: {
          left: x,
          top: y - height, // Approximating top
          right: x + width,
          bottom: y,
          width,
          height
        }
      };
    }).filter(l => l.text.trim().length > 0);

    // Merge fragments roughly on the same line horizontally?
    // Often pdfjs emits many small fragments. Some merging might be needed, but let's try direct first.

    const fullPageText = lines.map(l => l.text).join(' ');
    console.log(`Page ${i} text length: ${fullPageText.length}`);

    if (!fullPageText.toLowerCase().includes(trainerName.trim().toLowerCase())) {
      console.log(`Page ${i} does not contain trainer name: ${trainerName.trim()}`);
      continue;
    }
    console.log(`Found trainer name on Page ${i}`);

    const timeHeaders = [];
    const dayHeaders = [];

    for (let line of lines) {
      const text = line.text.trim();
      if (isDay(text)) {
        dayHeaders.push(line);
      } else if (isTimeRange(text)) {
        timeHeaders.push(line);
      }
    }

    console.log(`Found ${dayHeaders.length} day headers and ${timeHeaders.length} time headers`);

    if (timeHeaders.length > 0 && dayHeaders.length > 0) {
      timeHeaders.sort((a, b) => a.bounds.left - b.bounds.left);
      dayHeaders.sort((a, b) => a.bounds.top - b.bounds.top);

      const contentLines = lines.filter(line => {
        return !timeHeaders.includes(line) &&
               !dayHeaders.includes(line) &&
               !line.text.includes('Teacher') &&
               !line.text.includes('Timetable generated') &&
               !line.text.includes('School of') &&
               !/^\d+$/.test(line.text.trim());
      });

      console.log(`Found ${contentLines.length} content lines`);

      let cellGroups = {};
      let lastAssignedKey = null;

      for (let line of contentLines) {
        let nearestDay = null;
        let minDayDist = Infinity;
        for (let day of dayHeaders) {
          const dist = Math.abs(line.bounds.top - day.bounds.top);
          if (dist < minDayDist) {
            minDayDist = dist;
            nearestDay = day;
          }
        }

        let nearestTime = null;
        let minTimeDist = Infinity;
        for (let time of timeHeaders) {
          const dist = Math.abs(line.bounds.left - time.bounds.left);
          if (dist < minTimeDist) {
            minTimeDist = dist;
            nearestTime = time;
          }
        }

        let key = null;
        if (nearestDay && nearestTime) {
          key = `${nearestDay.text}_${nearestTime.text}`;
        }

        if (line.text.trim().startsWith("Group") && lastAssignedKey != null) {
          key = lastAssignedKey;
        }

        if (key != null) {
          if (!cellGroups[key]) cellGroups[key] = [];
          cellGroups[key].push(line);
          lastAssignedKey = key;
        }
      }

      console.log(`Grouped content into ${Object.keys(cellGroups).length} cells`);

      let entriesCreated = 0;

      for (const [key, cellLines] of Object.entries(cellGroups)) {
        const parts = key.split('_');
        const dayText = parts[0];
        const timeText = parts[1];

        cellLines.sort((a, b) => a.bounds.top - b.bounds.top);
        const cellText = cellLines.map(l => l.text.trim()).join('\n');

        const parsedContent = parseCellContent(cellText);

        if (parsedContent.subject || parsedContent.batch) {
          const timeRange = parseTimeRange(timeText);
          if (timeRange) {
            const contentRightEdge = cellLines.map(l => l.bounds.right).reduce((a, b) => Math.max(a, b), 0);
            const currentTimeHeader = timeHeaders.find(h => h.text === timeText);
            const currentTimeIdx = timeHeaders.indexOf(currentTimeHeader);
            const currentRight = currentTimeHeader.bounds.right;
            const nextColumnLeft = (currentTimeIdx + 1 < timeHeaders.length)
                ? timeHeaders[currentTimeIdx + 1].bounds.left
                : currentRight + 100;
            
            const columnGap = nextColumnLeft - currentRight;
            const isMergedCell = contentRightEdge > (currentRight + columnGap * 0.5);
            const durationMinutes = isMergedCell ? 100 : 50;

            const endTime = new Date(timeRange.start.getTime() + durationMinutes * 60000);

            entries.push({
              dayOfWeek: normalizeDay(dayText),
              startTime: timeRange.start.toISOString(),
              endTime: endTime.toISOString(),
              timeRange: `${timeRange.start.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - ${endTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`,
              subject: parsedContent.subject,
              roomCode: parsedContent.room,
              batch: parsedContent.batch,
              group: parsedContent.group
            });
            entriesCreated++;
          }
        }
      }

      if (entries.length > 0) {
        break;
      }
    }
  }

  return entries;
}

module.exports = { extractTimetable };
