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

  const itemsText = mailItems.map((item, i) => {
    const d = item.details || {};
    return [
      `--- Item ${i + 1} ---`,
      `ID: ${item.id}`,
      `Sender/Vendor: ${item.vendor || 'Unknown'}`,
      `Summary: ${item.summary || 'N/A'}`,
      `Category: ${item.category || 'N/A'}`,
      `Current Priority: ${item.priority || 'N/A'}`,
      `Current Status: ${item.status || 'N/A'}`,
      `Amount Due: ${item.amount != null ? '$' + Number(item.amount).toFixed(2) : 'N/A'}`,
      `Due Date: ${item.due_date || 'N/A'}`,
      `Past Due: ${d.is_past_due ? 'YES' : 'No'}`,
      `Recurring: ${item.is_recurring ? 'Yes' : 'No'}`,
      `Late Fees: ${d.late_fees > 0 ? '$' + Number(d.late_fees).toFixed(2) : 'None'}`,
      `Billing Period: ${d.billing_period || 'N/A'}`,
    ].join('\n');
  }).join('\n\n');

  const prompt = `Today is ${today}. Prioritize these ${mailItems.length} mail items for a business owner. Return ONLY valid JSON, no markdown.

ITEMS:
${itemsText}

PRIORITY RULES (apply in order):
1. HIGH PRIORITY: Tax/IRS/government notices, legal, collections, past-due with fees, penalties, service disruption threats
2. MEDIUM PRIORITY: Utilities, insurance, subscriptions, medical bills, credit cards, vendor bills
3. LOW PRIORITY: Recurring bills before due date, non-urgent vendors
4. INFORMATIONAL: Zero-balance statements, EXPLICITLY confirmed paid/autopaid/complete/done items, notices requiring no action

CRITICAL: Never assume paid unless item explicitly says paid/autopaid/complete/done. When uncertain, use higher priority.

Return this JSON (no extra text):
{
  "title": "Mail Priority Report — ${today}",
  "summary": "2-3 sentences on the most urgent items and overall status",
  "itemsScanned": ${mailItems.length},
  "highestPriorityItems": [{"id":"exact_id","sender":"name","recommendedPriority":"High Priority","reason":"one sentence","recommendedAction":"one sentence"}],
  "priorityUpdates": [{"id":"exact_id","priority":"High Priority"}],
  "archiveCandidates": [{"id":"exact_id","reason":"one sentence"}],
  "processImprovements": ["suggestion 1","suggestion 2","suggestion 3"]
}

Rules: Include ALL ${mailItems.length} items in priorityUpdates. Order highestPriorityItems most-to-least urgent. Priority values must be exactly: "High Priority", "Medium Priority", "Low Priority", or "Informational".`;

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
        max_tokens: 800,
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
