<?php
/**
 * SVG icon library for the admin panel.
 *
 * Usage:  <?php echo icon('people'); ?>
 *
 * Optional params:
 *   echo icon('people', '#ffffff', 22);   // white, 22px  (sidebar)
 *   echo icon('people', 'var(--brand-primary)', 24);   // brand colour, 24px (content headers)
 *
 * $color may be any CSS colour, including var(...) references.
 *
 * Available icon names:
 *   users | audit-log | branding | people | triggers | business-hours
 *   on-call | system-config | call-logs |
 *   call-flow-messages | emergency | greetings | phone-numbers | timing |
 *   warning
 */

function icon(string $name, string $color = 'var(--brand-primary)', int $size = 22): string {

    $s    = htmlspecialchars($color);
    $w    = $size;
    $h    = $size;

    $attrs = "width=\"{$w}\" height=\"{$h}\" viewBox=\"0 0 24 24\" "
           . "stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" "
           . "stroke-linejoin=\"round\" fill=\"none\" "
           . "style=\"color:{$s};display:inline-block;vertical-align:middle;flex-shrink:0;\"";

    switch ($name) {

        case 'branding':
            return "<svg {$attrs}>
                <path d=\"M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-7.8-9-7.8z\" />
                <circle cx=\"7.5\" cy=\"11\" r=\"1\" />
                <circle cx=\"10.5\" cy=\"7\" r=\"1\" />
                <circle cx=\"15\" cy=\"7.5\" r=\"1\" />
            </svg>";

        case 'users':
            return "<svg {$attrs}>
                <circle cx=\"12\" cy=\"8\" r=\"4\" />
                <path d=\"M4 21v-1a8 8 0 0 1 16 0v1\" />
            </svg>";

        case 'audit-log':
            return "<svg {$attrs}>
                <rect x=\"4\" y=\"2\" width=\"12\" height=\"16\" rx=\"1.5\" />
                <path d=\"M8 7h5M8 10h5M8 13h3\" />
                <circle cx=\"16.5\" cy=\"17.5\" r=\"2.5\" />
                <path d=\"M18.5 19.5 L21 22\" />
            </svg>";

        case 'people':
            return "<svg {$attrs}>
                <circle cx=\"9\" cy=\"8\" r=\"3.5\" />
                <path d=\"M2 21v-.5A6.5 6.5 0 0 1 15.5 20.5V21\" />
                <circle cx=\"17.5\" cy=\"8\" r=\"2.5\" />
                <path d=\"M22 21v-.5a5 5 0 0 0-4.5-4.97\" />
            </svg>";

        case 'triggers':
            return "<svg {$attrs}>
                <path d=\"M13 2L4.5 13.5H11L10 22L20.5 10H14L13 2z\" />
            </svg>";

        case 'business-hours':
            return "<svg {$attrs}>
                <circle cx=\"12\" cy=\"12\" r=\"9\" />
                <path d=\"M12 7v5l3 3\" />
                <path d=\"M12 3v1M12 20v1M3 12h1M20 12h1\" stroke-width=\"1.5\" />
            </svg>";

        case 'on-call':
            return "<svg {$attrs}>
                <rect x=\"3\" y=\"4\" width=\"14\" height=\"13\" rx=\"1.5\" />
                <path d=\"M7 2v3M13 2v3M3 9h14\" />
                <circle cx=\"17.5\" cy=\"17.5\" r=\"4.5\" fill=\"white\" stroke=\"currentColor\" stroke-width=\"1.8\" />
                <path d=\"M17.5 15v2.5l1.5 1.5\" />
            </svg>";

        case 'system-config':
            return "<svg {$attrs}>
                <circle cx=\"12\" cy=\"12\" r=\"3\" />
                <path d=\"M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z\" />
            </svg>";

        case 'call-logs':
            return "<svg {$attrs}>
                <path d=\"M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2
                          1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1
                          C9.6 21 3 14.4 3 6c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1
                          0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z\" />
                <path d=\"M15 5h4M15 8h4M15 11h2\" stroke-width=\"1.5\" />
            </svg>";

        case 'call-flow-messages':
            return "<svg {$attrs}>
                <rect x=\"9\" y=\"2\" width=\"6\" height=\"11\" rx=\"3\" />
                <path d=\"M5 11a7 7 0 0 0 14 0\" />
                <path d=\"M12 18v3M8 21h8\" />
            </svg>";

        case 'emergency':
            return "<svg {$attrs}>
                <path d=\"M5 20h14v2H5z\" stroke-linejoin=\"round\" />
                <path d=\"M6 20 C6 5 18 5 18 20\" />
                <path d=\"M12 9V4.5\" />
                <path d=\"M7 10L4.5 7.5\" stroke-width=\"1.5\" />
                <path d=\"M17 10L19.5 7.5\" stroke-width=\"1.5\" />
                <path d=\"M4 14H2\" stroke-width=\"1.5\" />
                <path d=\"M20 14h2\" stroke-width=\"1.5\" />
            </svg>";

        case 'greetings':
            return "<svg {$attrs}>
                <path d=\"M9 11V5a1.5 1.5 0 0 1 3 0v6\" />
                <path d=\"M12 5.5V4a1.5 1.5 0 0 1 3 0v7\" />
                <path d=\"M15 6a1.5 1.5 0 0 1 3 0v5\" />
                <path d=\"M9 11a1.5 1.5 0 0 0-3 0v3a6 6 0 0 0 12 0v-4a1.5 1.5 0 0 0-3 0\" />
                <path d=\"M6.5 8.5A2 2 0 0 0 5 10.5v.5\" />
            </svg>";

        case 'phone-numbers':
            return "<svg {$attrs}>
                <path d=\"M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2
                          1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1
                          C9.6 21 3 14.4 3 6c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1
                          0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z\" />
                <path d=\"M15 3h5M15 6h5M16 2v5M19 2v5\" stroke-width=\"1.5\" />
            </svg>";

        case 'timing':
            return "<svg {$attrs}>
                <circle cx=\"12\" cy=\"13\" r=\"8\" />
                <path d=\"M12 9v4l2.5 2.5\" />
                <path d=\"M10 2h4\" />
                <path d=\"M12 2v3\" />
                <path d=\"M19 5l-1.5 1.5\" />
            </svg>";

        case 'warning':
            return "<svg {$attrs}>
                <path d=\"M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z\" />
                <path d=\"M12 9v4\" stroke-width=\"2\" />
                <circle cx=\"12\" cy=\"17\" r=\"0.5\" fill=\"currentColor\" stroke-width=\"2\" />
            </svg>";

        default:
            return "<svg {$attrs}><circle cx=\"12\" cy=\"12\" r=\"8\" /></svg>";
    }
}
