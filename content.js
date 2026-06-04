(function () {
  const DETAIL_URL_RE = /\/odoo\/attendances\/(\d+)(?:[/?#]|$)/;
  const TZ_OFFSET_HOURS = 7;
  const BUTTON_ID = 'attendance-fixer-button';
  const MODAL_ID = 'attendance-fixer-modal';
  const INIT_DELAY_MS = 400;

  let lastUrl = '';
  let initTimer = null;

  init();

  function init() {
    scheduleRender();
    observeUrlChanges();

    const observer = new MutationObserver(() => {
      const currentUrl = location.href;
      if (currentUrl !== lastUrl || shouldRenderButton()) {
        scheduleRender();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function observeUrlChanges() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function () {
      originalPushState.apply(this, arguments);
      scheduleRender();
    };

    history.replaceState = function () {
      originalReplaceState.apply(this, arguments);
      scheduleRender();
    };

    window.addEventListener('popstate', scheduleRender);
  }

  function scheduleRender() {
    clearTimeout(initTimer);
    initTimer = setTimeout(renderForCurrentPage, INIT_DELAY_MS);
  }

  function renderForCurrentPage() {
    lastUrl = location.href;

    const attendanceId = getAttendanceId();
    if (!attendanceId) {
      removeButton();
      removeModal();
      return;
    }

    if (!document.querySelector('[name="ngaychamcong"]')) {
      return;
    }

    ensureFixButton();
  }

  function shouldRenderButton() {
    return Boolean(getAttendanceId()) && !document.getElementById(BUTTON_ID);
  }

  function getAttendanceId() {
    const match = location.pathname.match(DETAIL_URL_RE);
    return match ? Number(match[1]) : null;
  }

  function ensureFixButton() {
    if (document.getElementById(BUTTON_ID)) {
      return;
    }

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = 'Fix';
    button.addEventListener('click', openFixModal);

    const actions = findActionContainer();
    if (actions) {
      actions.appendChild(button);
    } else {
      button.classList.add('attendance-fixer-floating');
      document.body.appendChild(button);
    }
  }

  function findActionContainer() {
    return (
      document.querySelector('.o_form_button_box') ||
      document.querySelector('.o_control_panel_main_buttons') ||
      document.querySelector('.o_cp_action_menus') ||
      document.querySelector('.o_content')
    );
  }

  function removeButton() {
    const button = document.getElementById(BUTTON_ID);
    if (button) {
      button.remove();
    }
  }

  async function openFixModal() {
    removeModal();

    const modal = createModalShell();
    const dialog = modal.querySelector('.attendance-fixer-dialog');
    dialog.appendChild(createTitle('Fix attendance'));
    dialog.appendChild(createMeta('Checking API connection...'));
    document.body.appendChild(modal);

    let health = null;
    try {
      health = await checkHealth();
    } catch (error) {
      health = {
        success: false,
        error: error && error.message ? error.message : String(error),
      };
    }

    dialog.innerHTML = '';

    if (!health || health.success !== true) {
      renderUnavailableDialog(dialog, health && health.error ? health.error : 'API health check failed.');
      return;
    }

    const draft = buildDraft();
    if (!draft.ok) {
      renderUnavailableDialog(dialog, draft.error);
      return;
    }

    dialog.appendChild(createTitle('Fix attendance'));
    dialog.appendChild(createMeta('API connected.'));
    dialog.appendChild(createMeta(`ID: ${draft.id}`));
    dialog.appendChild(createMeta(`Ngày chấm công: ${formatDisplayDate(draft.attendanceDate)}`));

    const checkInInput = createDateTimeField('Check-in (+7)', draft.checkInLocal);
    const checkOutInput = createDateTimeField('Check-out (+7)', draft.checkOutLocal);
    dialog.appendChild(checkInInput.wrapper);
    dialog.appendChild(checkOutInput.wrapper);

    const note = document.createElement('div');
    note.className = 'attendance-fixer-note';
    note.textContent = 'Payload gửi server dùng UTC +0.';
    dialog.appendChild(note);

    const errorBox = document.createElement('div');
    errorBox.className = 'attendance-fixer-error';
    errorBox.hidden = true;
    dialog.appendChild(errorBox);

    const actions = document.createElement('div');
    actions.className = 'attendance-fixer-actions';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'attendance-fixer-secondary';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', removeModal);

    const updateButton = document.createElement('button');
    updateButton.type = 'button';
    updateButton.className = 'attendance-fixer-primary';
    updateButton.textContent = 'Update';
    updateButton.addEventListener('click', async () => {
      const payload = buildPayload(draft.id, checkInInput.input.value, checkOutInput.input.value);
      if (!payload.ok) {
        showInlineError(errorBox, payload.error);
        return;
      }

      updateButton.disabled = true;
      cancelButton.disabled = true;
      updateButton.textContent = 'Updating...';
      errorBox.hidden = true;

      try {
        const result = await sendUpdate(payload.value);
        if (!result || result.success !== true) {
          throw new Error(result && result.error ? result.error : 'Update failed');
        }
        window.location.reload();
      } catch (error) {
        updateButton.disabled = false;
        cancelButton.disabled = false;
        updateButton.textContent = 'Update';
        showInlineError(errorBox, error && error.message ? error.message : String(error));
      }
    });

    actions.appendChild(cancelButton);
    actions.appendChild(updateButton);
    dialog.appendChild(actions);
    checkInInput.input.focus();
  }

  function buildDraft() {
    const id = getAttendanceId();
    const attendanceDate = parseDisplayDate(readFieldText('[name="ngaychamcong"] span'));
    if (!id) {
      return { ok: false, error: 'Không lấy được attendance id từ URL.' };
    }
    if (!attendanceDate) {
      return { ok: false, error: 'Không đọc được Ngày chấm công.' };
    }

    const currentCheckIn = parseDisplayDateTime(readFieldText('[name="check_in"] span'));
    const currentCheckOut = parseDisplayDateTime(readFieldText('[name="check_out"] span'));

    const checkInLocal = isValidAttendanceTime(currentCheckIn, attendanceDate, 'in')
      ? currentCheckIn
      : randomLocalDateTime(attendanceDate, 8, 30, 8, 55);
    const checkOutLocal = isValidAttendanceTime(currentCheckOut, attendanceDate, 'out')
      ? currentCheckOut
      : randomLocalDateTime(attendanceDate, 18, 0, 18, 25);

    return {
      ok: true,
      id,
      attendanceDate,
      checkInLocal,
      checkOutLocal,
    };
  }

  function readFieldText(selector) {
    const node = document.querySelector(selector);
    return node ? node.textContent.trim() : '';
  }

  function parseDisplayDate(value) {
    const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) {
      return null;
    }
    return {
      day: Number(match[1]),
      month: Number(match[2]),
      year: Number(match[3]),
      hour: 0,
      minute: 0,
      second: 0,
    };
  }

  function parseDisplayDateTime(value) {
    const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) {
      return null;
    }
    return {
      day: Number(match[1]),
      month: Number(match[2]),
      year: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: Number(match[6]),
    };
  }

  function isValidAttendanceTime(value, date, type) {
    if (!value || !isSameLocalDate(value, date)) {
      return false;
    }

    const seconds = value.hour * 3600 + value.minute * 60 + value.second;
    if (type === 'in') {
      return seconds >= timeToSeconds(8, 30, 0) && seconds <= timeToSeconds(8, 55, 59);
    }
    return seconds >= timeToSeconds(18, 0, 0) && seconds <= timeToSeconds(18, 25, 59);
  }

  function isSameLocalDate(value, date) {
    return value.day === date.day && value.month === date.month && value.year === date.year;
  }

  function timeToSeconds(hour, minute, second) {
    return hour * 3600 + minute * 60 + second;
  }

  function randomLocalDateTime(date, startHour, startMinute, endHour, endMinute) {
    const start = timeToSeconds(startHour, startMinute, 0);
    const end = timeToSeconds(endHour, endMinute, 59);
    const seconds = start + Math.floor(Math.random() * (end - start + 1));

    return {
      year: date.year,
      month: date.month,
      day: date.day,
      hour: Math.floor(seconds / 3600),
      minute: Math.floor((seconds % 3600) / 60),
      second: seconds % 60,
    };
  }

  function createModalShell() {
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'attendance-fixer-modal';

    const backdrop = document.createElement('div');
    backdrop.className = 'attendance-fixer-backdrop';
    backdrop.addEventListener('click', removeModal);

    const dialog = document.createElement('div');
    dialog.className = 'attendance-fixer-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    modal.appendChild(backdrop);
    modal.appendChild(dialog);
    return modal;
  }

  function createTitle(text) {
    const title = document.createElement('h2');
    title.className = 'attendance-fixer-title';
    title.textContent = text;
    return title;
  }

  function createMeta(text) {
    const meta = document.createElement('div');
    meta.className = 'attendance-fixer-meta';
    meta.textContent = text;
    return meta;
  }

  function createDateTimeField(labelText, value) {
    const wrapper = document.createElement('label');
    wrapper.className = 'attendance-fixer-field';

    const label = document.createElement('span');
    label.textContent = labelText;

    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.step = '1';
    input.value = toDateTimeLocalValue(value);

    wrapper.appendChild(label);
    wrapper.appendChild(input);

    return { wrapper, input };
  }

  function showErrorModal(error) {
    const modal = createModalShell();
    const dialog = modal.querySelector('.attendance-fixer-dialog');
    renderUnavailableDialog(dialog, error);

    document.body.appendChild(modal);
  }

  function renderUnavailableDialog(dialog, error) {
    dialog.appendChild(createTitle('Fix attendance'));

    const errorBox = document.createElement('div');
    errorBox.className = 'attendance-fixer-error';
    errorBox.textContent = error;
    dialog.appendChild(errorBox);

    const actions = document.createElement('div');
    actions.className = 'attendance-fixer-actions';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'attendance-fixer-primary';
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', removeModal);
    actions.appendChild(closeButton);
    dialog.appendChild(actions);
  }

  function showInlineError(errorBox, error) {
    errorBox.textContent = error;
    errorBox.hidden = false;
  }

  function removeModal() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) {
      modal.remove();
    }
  }

  function buildPayload(id, checkInValue, checkOutValue) {
    const checkInLocal = parseDateTimeLocalValue(checkInValue);
    const checkOutLocal = parseDateTimeLocalValue(checkOutValue);

    if (!checkInLocal || !checkOutLocal) {
      return { ok: false, error: 'Thời gian không hợp lệ.' };
    }

    const checkInUtcMs = localPlus7ToUtcMs(checkInLocal);
    const checkOutUtcMs = localPlus7ToUtcMs(checkOutLocal);
    if (checkOutUtcMs <= checkInUtcMs) {
      return { ok: false, error: 'Check-out phải sau check-in.' };
    }

    return {
      ok: true,
      value: {
        id,
        checkIn: formatUtcSqlDateTime(checkInUtcMs),
        checkOut: formatUtcSqlDateTime(checkOutUtcMs),
      },
    };
  }

  function parseDateTimeLocalValue(value) {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) {
      return null;
    }
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: Number(match[6] || 0),
    };
  }

  function localPlus7ToUtcMs(value) {
    return Date.UTC(
      value.year,
      value.month - 1,
      value.day,
      value.hour - TZ_OFFSET_HOURS,
      value.minute,
      value.second,
    );
  }

  function formatUtcSqlDateTime(utcMs) {
    const date = new Date(utcMs);
    return [
      date.getUTCFullYear(),
      pad(date.getUTCMonth() + 1),
      pad(date.getUTCDate()),
    ].join('-') + ' ' + [
      pad(date.getUTCHours()),
      pad(date.getUTCMinutes()),
      pad(date.getUTCSeconds()),
    ].join(':');
  }

  function toDateTimeLocalValue(value) {
    return `${value.year}-${pad(value.month)}-${pad(value.day)}T${pad(value.hour)}:${pad(value.minute)}:${pad(value.second)}`;
  }

  function formatDisplayDate(value) {
    return `${pad(value.day)}/${pad(value.month)}/${value.year}`;
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function sendUpdate(payload) {
    return chrome.runtime.sendMessage({
      type: 'UPDATE_ATTENDANCE',
      payload,
    });
  }

  function checkHealth() {
    return chrome.runtime.sendMessage({
      type: 'CHECK_HEALTH',
    });
  }
})();
