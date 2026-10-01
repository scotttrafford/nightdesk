/* call-logs.js — all interactivity for call-logs.php */

let currentInferenceId = null;
let currentPhrase = null;

// ─── Refresh button ───────────────────────────────────────────────────────────

document.getElementById('btn-refresh').addEventListener('click', function () {
    location.reload();
});

// ─── Debug log modal ─────────────────────────────────────────────────────────

document.querySelectorAll('.debug-log-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
        var log = btn.getAttribute('data-log') || 'No log available';
        document.getElementById('debug-log-content').textContent = log;
        document.getElementById('debugModal').style.display = 'block';
    });
});

document.getElementById('close-debug-modal').addEventListener('click', function () {
    document.getElementById('debugModal').style.display = 'none';
});

// ─── Inference modal ──────────────────────────────────────────────────────────

document.querySelectorAll('.inference-badge').forEach(function (badge) {
    badge.addEventListener('click', function () {
        var data = JSON.parse(badge.getAttribute('data-inference'));
        currentInferenceId = data.id;
        currentPhrase = data.caller_phrase;

        document.getElementById('modal-phrase').textContent    = data.caller_phrase || 'N/A';
        document.getElementById('modal-reasoning').textContent = data.ai_reasoning  || 'N/A';

        var title = document.getElementById('help-title');
        var text  = document.getElementById('help-text');
        if (data.validated === 't') {
            title.textContent = 'Already Approved';
            text.textContent  = 'This inference was previously approved. You can change the decision below if needed.';
        } else if (data.validated === 'f') {
            title.textContent = 'Already Rejected';
            text.textContent  = 'This inference was previously marked as incorrect. You can change the decision below if needed.';
        } else {
            title.textContent = 'Action Required:';
            text.textContent  = 'If the AI correctly identified this as urgent, save it as a trigger. Otherwise, mark it as a bad inference.';
        }

        document.getElementById('inferenceModal').style.display = 'block';
    });
});

document.getElementById('close-inference-modal').addEventListener('click', function () {
    document.getElementById('inferenceModal').style.display = 'none';
});

// ─── Inference action buttons ─────────────────────────────────────────────────

document.querySelectorAll('.action-buttons [data-action]').forEach(function (btn) {
    btn.addEventListener('click', function () {
        var type = btn.getAttribute('data-action');
        if (!currentInferenceId || !currentPhrase) {
            alert('Error: Missing data');
            return;
        }
        var form = document.createElement('form');
        form.method = 'POST';
        form.action = 'call-logs-inference-handler.php';
        var fields = {
            inference_id: currentInferenceId,
            phrase: currentPhrase,
            action: type,
            csrf: document.querySelector('meta[name="csrf-token"]').content
        };
        Object.keys(fields).forEach(function (key) {
            var input = document.createElement('input');
            input.type  = 'hidden';
            input.name  = key;
            input.value = fields[key];
            form.appendChild(input);
        });
        document.body.appendChild(form);
        form.submit();
    });
});

// ─── Close modals on outside click ───────────────────────────────────────────

window.addEventListener('click', function (e) {
    if (e.target === document.getElementById('inferenceModal')) {
        document.getElementById('inferenceModal').style.display = 'none';
    }
    if (e.target === document.getElementById('debugModal')) {
        document.getElementById('debugModal').style.display = 'none';
    }
});
