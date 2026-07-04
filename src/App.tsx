import React from 'react';
import {
  useStore,
  toggleWindow,
  openGroupChat,
  openDMChat,
  openOrCreateDM,
} from './store/appStore';
import FloatingBar from './components/FloatingBar';
import FloatingWindow from './components/FloatingWindow';
import ChatWindow from './components/ChatWindow';
import HomeView from './components/HomeView';
import Onboarding from './components/Onboarding';
import ConnectPanel from './components/panels/ConnectPanel';
import GroupsPanel from './components/panels/GroupsPanel';
import ChatPanel from './components/panels/ChatPanel';
import SettingsPanel from './components/panels/SettingsPanel';
import type { PanelId } from './types';
import './App.css';

const WINDOW_TITLES: Record<PanelId, string> = {
  connect:    'Connect',
  groups:     'Groups',
  chat:       'Messages',
  chatwindow: 'Chat',
  settings:   'Settings',
};

export default function App() {
  const state = useStore();
  const [claimed] = React.useState(true); // flip to false to test onboarding

  if (!claimed) {
    return <Onboarding onClaim={() => {}} />;
  }

  const { me, users, groups, dms, openWindows, chatView } = state;
  if (!me) return null;

  const dmUnread    = dms.reduce((a, d) => a + d.unread, 0);
  const groupUnread = groups.flatMap(g => g.channels).reduce((a, c) => a + c.unread, 0);
  const totalUnread = dmUnread + groupUnread;

  function handleOpenDM(dmId: string) { openDMChat(dmId); }
  function handleOpenGroup(groupId: string) { openGroupChat(groupId); }

  function renderWindowContent(id: PanelId) {
    switch (id) {
      case 'connect':
        return <ConnectPanel onOpenDM={handleOpenDM} />;
      case 'groups':
        return <GroupsPanel onOpen={handleOpenGroup} />;
      case 'chat':
        return <ChatPanel onOpenDM={handleOpenDM} onOpenGroup={handleOpenGroup} />;
      case 'chatwindow':
        return (
          <ChatWindow
            chatView={chatView}
            users={users}
            me={me}
            groups={groups}
            dms={dms}
          />
        );
      case 'settings':
        return <SettingsPanel />;
    }
  }

  return (
    <div className="app">
      {/* Hermes hw-frame — fixed thick border all around */}
      <div className="hw-frame" aria-hidden />

      {/* Full-bleed background — hero art, noise, home content */}
      <div className="app-bg">
        <img className="app-hero-art" src="/img/hero-art.jpg" alt="" aria-hidden />
        <HomeView
          username={me.username}
          userId={me.id}
          groupCount={groups.length}
          dmUnread={dmUnread}
        />
      </div>

      {/* Floating icon bar */}
      <FloatingBar
        openWindows={openWindows}
        onToggle={toggleWindow}
        username={me.username}
        totalUnread={totalUnread}
      />

      {/* Floating windows */}
      {openWindows.map(win => (
        <FloatingWindow
          key={win.id}
          win={win}
          title={WINDOW_TITLES[win.id]}
        >
          {renderWindowContent(win.id)}
        </FloatingWindow>
      ))}
    </div>
  );
}
