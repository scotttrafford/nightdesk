/* brand-picker.js — presets and live preview for the colour-scheme picker (see brand_picker() in branding.php) */

const bpRoot = document.documentElement;
const bpPrimary = document.getElementById('bp-primary');
const bpAccent = document.getElementById('bp-accent');
const bpApply = () => {
    bpRoot.style.setProperty('--brand-primary', bpPrimary.value);
    bpRoot.style.setProperty('--brand-accent', bpAccent.value);
};
bpPrimary.addEventListener('input', bpApply);
bpAccent.addEventListener('input', bpApply);
document.querySelectorAll('.bp-scheme').forEach(btn => btn.addEventListener('click', () => {
    bpPrimary.value = btn.dataset.primary;
    bpAccent.value = btn.dataset.accent;
    bpApply();
}));
