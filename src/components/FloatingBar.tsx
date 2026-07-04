import React from 'react';
import { Link2, Users, MessageSquare, Settings, MessagesSquare } from 'lucide-react';
import type { PanelId, WindowState } from '../types';
import './FloatingBar.css';

interface Props {
  openWindows: WindowState[];
  onToggle: (id: PanelId) => void;
  username: string;
  totalUnread: number;
}

const BUTTONS: { id: PanelId; icon: React.ReactNode; tooltip: string }[] = [
  { id: 'connect',    icon: <Link2 size={17} />,          tooltip: 'Connect'    },
  { id: 'groups',     icon: <Users size={17} />,           tooltip: 'Groups'     },
  { id: 'chat',       icon: <MessageSquare size={17} />,   tooltip: 'Messages'   },
  { id: 'chatwindow', icon: <MessagesSquare size={17} />,  tooltip: 'Chat'       },
  { id: 'settings',   icon: <Settings size={17} />,        tooltip: 'Settings'   },
];

export default function FloatingBar({ openWindows, onToggle, username, totalUnread }: Props) {
  const openIds = openWindows.map(w => w.id);

  return (
    <div className="fbar">
      {/* brand */}
      <div className="fbar-brand" title="TeaChat">
        <span className="fbar-logo">🍵</span>
      </div>

      <div className="fbar-divider" />

      {/* icon buttons */}
      {BUTTONS.map(b => (
        <button
          key={b.id}
          className={`fbar-btn ${openIds.includes(b.id) ? 'active' : ''}`}
          onClick={() => onToggle(b.id)}
          aria-label={b.tooltip}
        >
          {b.icon}
          {/* unread badge on messages + chatwindow */}
          {(b.id === 'chat' || b.id === 'chatwindow') && totalUnread > 0 && (
            <span className="fbar-badge">{totalUnread > 9 ? '9+' : totalUnread}</span>
          )}
          <span className="fbar-tooltip">{b.tooltip}</span>
        </button>
      ))}

      <div className="fbar-divider" />

      {/* user identity */}
      <div className="fbar-user" title={`@${username}`}>
        <span className="fbar-user-initial">{username[0].toUpperCase()}</span>
        <span className="fbar-tooltip fbar-tooltip--left">@{username}</span>
      </div>
    </div>
  );
}
