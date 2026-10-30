const ATTENDANCE_UPDATE_URL = 'https://apicc.neoo.io.vn/api/attendance/update';
const HEALTH_CHECK_URL = 'https://apicc.neoo.io.vn/health';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !['UPDATE_ATTENDANCE', 'CHECK_HEALTH'].includes(message.type)) {
    return false;
  }

  const task = message.type === 'CHECK_HEALTH'
    ? checkHealth()
    : updateAttendance(message.payload);

  task
    .then((result) => sendResponse(result))
    .catch((error) => {
      sendResponse({
        success: false,
        error: error && error.message ? error.message : String(error),
      });
    });

  return true;
});

async function checkHealth() {
  const response = await fetch(HEALTH_CHECK_URL, {
    method: 'GET',
  });

  let body = null;
  try {
    body = await response.json();
  } catch (_error) {
    body = null;
  }

  if (!response.ok || !body || body.ok !== true) {
    const error = body && body.error ? body.error : `Health check failed: HTTP ${response.status}`;
    return { success: false, error };
  }

  return { success: true };
}

async function updateAttendance(payload) {
  const response = await fetch(ATTENDANCE_UPDATE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  let body = null;
  try {
    body = await response.json();
  } catch (_error) {
    body = null;
  }

  if (!response.ok || !body || body.success !== true) {
    const error = body && body.error ? body.error : `HTTP ${response.status}`;
    return { success: false, error };
  }

  return { success: true };
}
