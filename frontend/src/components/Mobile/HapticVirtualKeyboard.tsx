import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface HystematicKey {
  label: string;
  insert?: string;
  cursorOffset?: number;
}

export interface HapticVirtualKeyboardProps {
  /** Called when an accessory key is pressed. Receives the text to insert and the cursor offset to apply after insertion. */
  onInsert: (text: string, cursorOffset?: number) => void;
  /** Optional callback for keys that perform non-insert actions (e.g. tab/undo). */
  onAction?: (action: string) => void;
  /** Disable haptic feedback (defaults to true). */
  hapticsEnabled?: boolean;
  /** Optional extra class name for the container. */
  className?: string;
  /** Accessibility label for the accessory bar. */
  ariaLabel?: string;
}

const DEFAULT_KEYS: HystematicKey[] = [
  { label: '{', insert: '{', cursorOffset: 1 },
  { label: '}', insert: '}' },
  { label: '[', insert: '[', cursorOffset: 1 },
  { label: ']', insert: ']' },
  { label: '(', insert: '(', cursorOffset: 1 },
  { label: ')', insert: ')' },
  { label: ';', insert: ';' },
  { label: '->', insert: '->', cursorOffset: 2 },
  { label: '&', insert: '&' },
  { label: '*', insert: '*' },
  { label: '_', insert: '_' },
  { label: '=', insert: '=' },
];

const HAPTIC_DURATION_MS = 10;

function triggerHaptic(enabled: boolean): void {
  if (!enabled) {
    return;
  }
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return;
  }
  try {
    navigator.vibrate(HAPTIC_DURATION_MS);
  } catch {
    // Haptics are best-effort; silently ignore unsupported or blocked calls.
  }
}

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

export const HapticVirtualKeyboard: React.FC<HapticVirtualKeyboardProps> = ({
  onInsert,
  onAction,
  hapticsEnabled = true,
  className,
  ariaLabel = 'Code accessory keys',
}) => {
  const [keys] = useState<HystematicKey[]>(DEFAULT_KEYS);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const pressedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barRef = useRef<HTMLDivExtension | null>(null);

  useEffect(() => {
    return () => {
      if (pressedTimer.current) {
        clearTimeout(pressedTimer.current);
      }
    };
  }, []);

  // Prevent the accessory bar from stealing focus from the editor on touch devices.
  useEffect(() => {
    const node = barRef.current;
    if (!node) {
      return;
    }
    const handler = (event: TouchStartEvent) => {
      event.preventDefault();
    };
    node.addEventListener('touchstart', handler, { passive: false });
    return () => {
      node.removeEventListener('touchstart', handler);
    };
  }, []);

  const handleKey = useCallback(
    (key: HystematicKey) => {
      triggerHaptic(hapticsEnabled && isTouchDevice());
      setPressedKey(key.label);
      if (pressedTimer.current) {
        clearTimeout(pressedTimer.current);
      }
      pressedTimer.current = setTimeout(() => setPressedKey(null), 120);
      if (key.insert !== undefined) {
        onInsert(key.insert, key.cursorOffset);
      } else if (key.label && onAction) {
        onAction(key.label);
      }
    },
    [hapticsEnabled, onInsert, onAction],
  );

  return (
    <div
      ref={barRef}
      className={`flex items-center gap-1 overflow-x-auto px-2 py-1.5 border-t border-slate-700/60 bg-slate-900/95 backdrop-blur scrollbar-none select-none ${className ?? ''}`}
      role="toolbar"
      aria-label={ariaLabel}
      data-testid="haptic-virtual-keyboard"
    >
      {keys.map((key) => (
        <button
          key={key.label}
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            handleKey(key);
          }}
          onTouchStart={(event) => {
            event.preventDefault();
            handleKey(key);
          }}
          onClick={(event) => {
            // Keyboard activation fallback; touch/mouse already handled above.
            if (event.detail === 0) {
              handleKey(key);
            }
          }}
          aria-label={key.label}
          className={`inline-flex h-touch min-w-touch items-center justify-center rounded-md px-3 font-mono text-sm font-medium transition-colors duration-75 focus:outline-none focus-ring-2 focus:ring-cyan-400 ${pressedKey === key.label ? 'bg-cyan-500 text-slate-950 scale-95' : 'bg-slate-800/90 text-slate-100 active:bg-cyan-500 active:text-slate-950'}`}
        >
          {key.label}
        </button>
      ))}
    </div>
  );
};

export default HapticVirtualKeyboard;
