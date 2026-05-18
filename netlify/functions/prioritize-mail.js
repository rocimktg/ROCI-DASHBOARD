const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'CLAUDE_API_KEY not set' }) };
  }

  let mailItems;
  try {
    ({ mailItems } = JSON.parse(event.body));
    if (!Array.isArray(mailItems) || mailItems.length === 0) throw new Error('no mail items provided');
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid request: ' + e.message }) };
  }

  const today = new Date().toISOString().slice(0, 10);

  // One compact line per item keeps input tokens small
  const itemsText = mailItems.map(item => {
    const d = item.details || {};
    const amt   = item.amount != null ? `$${Number(item.amount).toFixed(2)}` : 'no amount';
    const due   = item.due_date || 'no due date';
    const flags = [
      d.is_past_due         ? 'PAST DUE'  : null,
      d.late_fees > 0       ? `late fee $${Number(d.late_fees).toFixed(2)}` : null,
      item.is_recurring     ? 'recurring' : null,
    ].filter(Boolean).join(', ');
    return `ID:${item.id} | ${item.vendor || 'Unknown'} | ${amt} | due:${due}${flags ? ' | ' + flags : ''} | ${item.summary || ''}`;
  }).join('\n');

  const prompt = `Today is ${today}. Assign a priority to each of these ${mailItems.length} mail items. Return ONLY compact JSON.

ITEMS:
${itemsText}

PRIORITY RULES:
HIGH: tax/IRS/government, legal, collections, past-due with fees, penalties, service threats
MEDIUM: utilities, insurance, medical, subscriptions, credit cards, vendor bills
LOW: recurring bills before due date, non-urgent
INFORMATIONAL: zero-balance, explicitly paid/autopaid/complete/done, no action needed
RULE: Never assume paid unless the item explicitly says paid/autopaid/complete/done. When uncertain, go higher.

Return this exact JSON (no markdown, no extra text):
{"summary":"2 sentences on most urgent items","priorityUpdates":[{"id":"exact_id_from_above","priority":"High Priority"}],"archiveCandidates":[{"id":"exact_id","reason":"why"}],"processImprovements":["tip1","tip2","tip3"]}

ALL ${mailItems.length} items must appear in priorityUpdates. Priority values: "High Priority" "Medium Priority" "Low Priority" "Informational"`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Claude API error: ' + errText }) };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';

    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) { try { parsed = JSON.parse(match[0]); } catch {} }
    }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Server error: ' + e.message }),
    };
  }
};
