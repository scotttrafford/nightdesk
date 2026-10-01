/* admin.js — loaded by admin.php, covers all admin-*.php includes */

// ─── Confirm dialogs on delete forms ─────────────────────────────────────────
// Any form with data-confirm="..." will prompt before submitting

document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
        var message = form.getAttribute('data-confirm');
        if (!confirm(message)) {
            e.preventDefault();
        }
    });
});

// ─── Business hours: toggle open/close time inputs ───────────────────────────
// Checkboxes with class 'day-closed-toggle' and data-day="N"

document.querySelectorAll('.day-closed-toggle').forEach(function (checkbox) {
    checkbox.addEventListener('change', function () {
        var dayNum   = checkbox.getAttribute('data-day');
        var isClosed = checkbox.checked;
        var open     = document.getElementById('open_time_'  + dayNum);
        var close    = document.getElementById('close_time_' + dayNum);
        [open, close].forEach(function (el) {
            if (isClosed) {
                el.setAttribute('readonly', true);
                el.style.background = '#f5f5f5';
                el.style.color      = '#999';
            } else {
                el.removeAttribute('readonly');
                el.style.background = '';
                el.style.color      = '';
            }
        });
    });
});
