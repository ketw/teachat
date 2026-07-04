import React, { useRef, useCallback } from 'react';
import type { WindowState, PanelId } from '../types';
import { bringToFront, moveWindow, closeWindow } from '../store/appStore';
import './FloatingWindow.css';

interface Props {
  win: WindowState;
  title: string;
  children: React.ReactNode;
}

export default function FloatingWindow({ win, title, children }: Props) {
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // only drag via the title bar
    if ((e.target as HTMLElement).closest('.fw-action')) return;
    bringToFront(win.id);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: win.x, origY: win.y };

    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      const frame = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--frame-size')) || 20;
      const nx = Math.max(frame, dragRef.current.origX + dx);
      const ny = Math.max(frame, dragRef.current.origY + dy);
      moveWindow(win.id, nx, ny);
    }

    function onUp() {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    e.preventDefault();
  }, [win]);

  return (
    <div
      className="fw"
      style={{ left: win.x, top: win.y, width: win.width, height: win.height, zIndex: win.zIndex }}
      onMouseDown={() => bringToFront(win.id)}
    >
      {/* title bar — drag handle */}
      <div className="fw-titlebar" onMouseDown={onMouseDown}>
        <span className="fw-title hw-mono">{title}</span>
        <button
          className="fw-action fw-close hw-mono"
          onClick={() => closeWindow(win.id)}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* content */}
      <div className="fw-body">
        {children}
      </div>
    </div>
  );
}
