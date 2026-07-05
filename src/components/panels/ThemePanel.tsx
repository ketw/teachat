import React, { useRef, useState } from 'react';
import { useTheme, DEFAULT_THEME } from '../../theme/themeContext';
import './ThemePanel.css';

// ── tiny reusable controls ────────────────────────────────────────
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="tp-row">
      <span className="tp-row-label hw-mono">{label}</span>
      <div className="tp-row-ctrl">{children}</div>
    </div>
  );
}

function ColorPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="tp-colorpick">
      <input type="color" value={value} onChange={e => onChange(e.target.value)} />
      <span className="tp-colorpick-val hw-mono">{value.toUpperCase()}</span>
    </div>
  );
}

function Slider({ value, min, max, step = 1, unit = '', onChange }: {
  value: number; min: number; max: number; step?: number;
  unit?: string; onChange: (v: number) => void;
}) {
  return (
    <div className="tp-slider">
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
      <span className="tp-slider-val hw-mono">{value}{unit}</span>
    </div>
  );
}

function Select({ value, options, onChange }: {
  value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <select className="tp-select hw-mono" value={value} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`tp-toggle hw-mono ${value ? 'on' : ''}`}
      onClick={() => onChange(!value)}
    >
      {value ? 'ON' : 'OFF'}
    </button>
  );
}

// ── Section wrapper ───────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="tp-section">
      <button className="tp-section-hd hw-mono" onClick={() => setOpen(o => !o)}>
        <span className="tp-section-arrow">{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && <div className="tp-section-body">{children}</div>}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────
export default function ThemePanel() {
  const { theme, set, reset, applyPreset, presetNames, exportTheme, importTheme } = useTheme();
  const fileRef  = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLTextAreaElement>(null);
  const [copyMsg, setCopyMsg] = useState('');
  const [importErr, setImportErr] = useState('');

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      set({ bgImage: ev.target?.result as string, bgMode: 'image' });
    };
    reader.readAsDataURL(file);
  }

  function handleCopyExport() {
    navigator.clipboard.writeText(exportTheme());
    setCopyMsg('Copied!');
    setTimeout(() => setCopyMsg(''), 1500);
  }

  function handleImport() {
    const val = importRef.current?.value ?? '';
    const ok = importTheme(val);
    setImportErr(ok ? '' : 'Invalid theme JSON');
  }

  return (
    <div className="tp">

      {/* ── Presets ─────────────────────────────────────────── */}
      <Section title="Presets">
        <div className="tp-presets">
          {presetNames.map(name => (
            <button key={name} className="tp-preset-btn hw-mono" onClick={() => applyPreset(name)}>
              {name}
            </button>
          ))}
        </div>
      </Section>

      {/* ── Background ──────────────────────────────────────── */}
      <Section title="Background">
        <Row label="Mode">
          <div className="tp-seg">
            <button className={`tp-seg-btn hw-mono ${theme.bgMode === 'color' ? 'active' : ''}`}
              onClick={() => set({ bgMode: 'color' })}>Color</button>
            <button className={`tp-seg-btn hw-mono ${theme.bgMode === 'image' ? 'active' : ''}`}
              onClick={() => set({ bgMode: 'image' })}>Image</button>
          </div>
        </Row>

        <Row label="BG Color">
          <ColorPick value={theme.bgColor} onChange={v => set({ bgColor: v })} />
        </Row>

        {theme.bgMode === 'image' && (
          <>
            <Row label="Image / GIF">
              <div className="tp-imgrow">
                <button className="tp-upload-btn hw-mono" onClick={() => fileRef.current?.click()}>
                  {theme.bgImage ? 'Change' : 'Upload Image / GIF'}
                </button>
                {theme.bgImage && (
                  <button className="tp-clear-btn hw-mono" onClick={() => set({ bgImage: '', bgMode: 'color' })}>
                    Remove
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/*,.gif" onChange={handleImageUpload} hidden />
              </div>
            </Row>
            {theme.bgImage && (
              <div className="tp-img-preview">
                <img src={theme.bgImage} alt="bg preview" />
              </div>
            )}
            <Row label="Opacity">
              <Slider value={theme.bgImageOpacity} min={0.05} max={1} step={0.05}
                onChange={v => set({ bgImageOpacity: v })} />
            </Row>
            <Row label="Blur">
              <Slider value={theme.bgImageBlur} min={0} max={20} unit="px"
                onChange={v => set({ bgImageBlur: v })} />
            </Row>
            <Row label="Size">
              <Select value={theme.bgImageSize}
                options={['cover', 'contain', 'fill', 'stretch', 'center', 'fit-width', 'fit-height', 'tile', 'tile-x', 'tile-y', 'auto']}
                onChange={v => set({ bgImageSize: v as any })} />
            </Row>
          </>
        )}
      </Section>

      {/* ── Colors ──────────────────────────────────────────── */}
      <Section title="Colors">
        <Row label="Foreground">
          <ColorPick value={theme.fgColor} onChange={v => set({ fgColor: v })} />
        </Row>
        <Row label="Accent">
          <ColorPick value={theme.accentColor} onChange={v => set({ accentColor: v })} />
        </Row>
        <Row label="Panel / Paper">
          <ColorPick value={theme.paperColor} onChange={v => set({ paperColor: v })} />
        </Row>
        <Row label="Frame Color">
          <div className="tp-colorpick">
            <input type="color" value={theme.frameColor || theme.bgColor}
              onChange={e => set({ frameColor: e.target.value })} />
            <span className="tp-colorpick-val hw-mono">
              {(theme.frameColor || theme.bgColor).toUpperCase()}
            </span>
            {theme.frameColor && (
              <button className="tp-link hw-mono" onClick={() => set({ frameColor: '' })}>
                ↺ sync
              </button>
            )}
          </div>
        </Row>
      </Section>

      {/* ── Frame & Borders ─────────────────────────────────── */}
      <Section title="Frame & Borders">
        <Row label="Frame Size">
          <Slider value={theme.frameSize} min={0} max={60} unit="px"
            onChange={v => set({ frameSize: v })} />
        </Row>
        <Row label="Border Opacity">
          <Slider value={Math.round(theme.borderOpacity * 100)} min={0} max={60} unit="%"
            onChange={v => set({ borderOpacity: v / 100 })} />
        </Row>
      </Section>

      {/* ── Corner Radii ─────────────────────────────────────── */}
      <Section title="Corner Radii">
        {/* Global override toggle */}
        <div className="tp-radii-global">
          <label className="tp-radii-global-label hw-mono">
            <input
              type="checkbox"
              className="tp-check"
              checked={theme.radii.globalEnabled}
              onChange={e => set({ radii: { ...theme.radii, globalEnabled: e.target.checked } })}
            />
            Global Override
          </label>
          <div className={`tp-radii-global-slider ${!theme.radii.globalEnabled ? 'tp-disabled' : ''}`}>
            <Slider
              value={theme.radii.globalValue}
              min={0} max={32} unit="px"
              onChange={v => set({ radii: { ...theme.radii, globalValue: v } })}
            />
          </div>
        </div>
        <p className="tp-radii-note hw-mono">
          {theme.radii.globalEnabled
            ? 'All values below are overridden — stored values preserved'
            : 'Set per-element values below'}
        </p>

        <div className={theme.radii.globalEnabled ? 'tp-disabled' : ''}>
          {/* Frame inner */}
          <Row label="Frame Inner">
            <Slider value={theme.radii.frameInner} min={0} max={32} unit="px"
              onChange={v => set({ radii: { ...theme.radii, frameInner: v } })} />
          </Row>

          {/* Frame outer — checkbox to enable */}
          <div className="tp-radii-check-row">
            <label className="tp-check-label hw-mono">
              <input
                type="checkbox"
                className="tp-check"
                checked={theme.radii.frameOuter}
                onChange={e => set({ radii: { ...theme.radii, frameOuter: e.target.checked } })}
              />
              Frame Outer Corners
            </label>
            <span className="tp-radii-note hw-mono">
              {theme.radii.frameOuter ? 'outer = inner + frame size' : 'Sharp outer corners'}
            </span>
          </div>

          <Row label="Windows">
            <Slider value={theme.radii.windows} min={0} max={32} unit="px"
              onChange={v => set({ radii: { ...theme.radii, windows: v } })} />
          </Row>
          <Row label="Panels / Cards">
            <Slider value={theme.radii.panels} min={0} max={32} unit="px"
              onChange={v => set({ radii: { ...theme.radii, panels: v } })} />
          </Row>
          <Row label="Buttons">
            <Slider value={theme.radii.buttons} min={0} max={32} unit="px"
              onChange={v => set({ radii: { ...theme.radii, buttons: v } })} />
          </Row>
          <Row label="Inputs">
            <Slider value={theme.radii.inputs} min={0} max={32} unit="px"
              onChange={v => set({ radii: { ...theme.radii, inputs: v } })} />
          </Row>
          <Row label="Floating Bar">
            <Slider value={theme.radii.bar} min={0} max={32} unit="px"
              onChange={v => set({ radii: { ...theme.radii, bar: v } })} />
          </Row>
        </div>
      </Section>

      {/* ── Windows ─────────────────────────────────────────── */}
      <Section title="Windows">
        <Row label="Titlebar Height">
          <Slider value={theme.windowTitlebarHeight} min={24} max={56} unit="px"
            onChange={v => set({ windowTitlebarHeight: v })} />
        </Row>
        <Row label="Focused Border">
          <ColorPick
            value={
              theme.windowFocusedBorder.startsWith('#')
                ? theme.windowFocusedBorder
                : theme.accentColor
            }
            onChange={v => set({ windowFocusedBorder: v })}
          />
          {theme.windowFocusedBorder && (
            <button className="tp-link hw-mono" onClick={() => set({ windowFocusedBorder: '' })}>
              ↺ auto
            </button>
          )}
        </Row>
        <Row label="Unfocused Opacity">
          <Slider value={Math.round(theme.windowUnfocusedOp * 100)} min={30} max={100} unit="%"
            onChange={v => set({ windowUnfocusedOp: v / 100 })} />
        </Row>
      </Section>

      {/* ── Floating Bar ────────────────────────────────────── */}
      <Section title="Floating Bar">
        <Row label="Bar Scale">
          <Slider value={Math.round(theme.barScale * 100)} min={70} max={150} unit="%"
            onChange={v => set({ barScale: v / 100 })} />
        </Row>
      </Section>

      {/* ── Effects ─────────────────────────────────────────── */}
      <Section title="Effects">
        <Row label="Noise Opacity">
          <Slider value={Math.round(theme.noiseOpacity * 100)} min={0} max={50} unit="%"
            onChange={v => set({ noiseOpacity: v / 100 })} />
        </Row>
      </Section>

      {/* ── Export / Import ─────────────────────────────────── */}
      <Section title="Export · Import">
        <div className="tp-export-row">
          <button className="tp-export-btn hw-mono" onClick={handleCopyExport}>
            {copyMsg || 'Copy Theme JSON'}
          </button>
          <button className="tp-reset-btn hw-mono" onClick={reset}>
            Reset to Default
          </button>
        </div>
        <textarea
          ref={importRef}
          className="tp-import-area hw-mono"
          placeholder={'Paste theme JSON here…'}
          rows={4}
          spellCheck={false}
        />
        {importErr && <p className="tp-import-err hw-mono">{importErr}</p>}
        <button className="tp-import-btn hw-mono" onClick={handleImport}>
          Apply Imported Theme
        </button>
      </Section>

    </div>
  );
}
