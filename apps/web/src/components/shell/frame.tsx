'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { FEATURES } from '@/components/brand/features';
import { CloseIcon, PlusIcon, ProfileIcon, SidebarIcon, SignOutIcon, TrashIcon } from '@/components/brand/icons';
import { GraspLogo, GraspMark } from '@/components/brand/logo';
import { useConfirm } from '@/components/ui/confirm';
import { signOut } from '@/lib/auth-client';
import { ThemeSwitch } from './theme';

/**
 * The Grasp shell — one sidebar for the whole product, after the pattern people
 * already know from ChatGPT and Claude:
 *
 *   logo · New chat · the five features · recent chats · account menu
 *
 * Docked on desktop (collapsible to icons — remembered per browser), an
 * off-canvas drawer on phones, opened from the top bar. The same component in
 * both places, so navigation never differs by screen size.
 *
 * Features come from `FEATURES`; the active one is marked `aria-current="page"`
 * and tinted with its colour. Recent chats live here rather than inside Ask, so
 * a conversation is one click from anywhere.
 */

export interface ShellUser {
  name: string;
  email: string;
  initials: string;
  /** e.g. "Class 10 · Mathematics" */
  subtitle: string;
}

interface Chat {
  id: string;
  title: string;
}

/** Ask announces created/renamed chats with this event; the sidebar refetches. */
export const CHATS_CHANGED = 'grasp:chats-changed';

const SIDEBAR_KEY = 'grasp.sidebar';

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function toggleCollapsed(): boolean {
  const root = document.documentElement;
  const collapsed = root.dataset.sidebar !== 'collapsed';
  if (collapsed) root.dataset.sidebar = 'collapsed';
  else delete root.dataset.sidebar;
  try {
    if (collapsed) localStorage.setItem(SIDEBAR_KEY, 'collapsed');
    else localStorage.removeItem(SIDEBAR_KEY);
  } catch {
    /* fine — applies for this page */
  }
  return collapsed;
}

// ---- recent chats -------------------------------------------------------------

function Recents({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const router = useRouter();
  const activeId = pathname.startsWith('/ask') ? params.get('session') : null;
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [confirm, dialog] = useConfirm();

  const load = useCallback(async () => {
    const res = await fetch('/api/sessions').catch(() => null);
    if (res?.ok) setChats(((await res.json()) as { sessions: Chat[] }).sessions);
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener(CHATS_CHANGED, load);
    return () => window.removeEventListener(CHATS_CHANGED, load);
  }, [load]);

  async function remove(chat: Chat) {
    const ok = await confirm({
      title: 'Delete this chat?',
      body: `“${chat.title}” will be removed from your chats.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    const res = await fetch(`/api/sessions?id=${chat.id}`, { method: 'DELETE' }).catch(() => null);
    // 404 means it is already gone; anything else failed, and hiding it would
    // only have it reappear on the next load.
    if (!res || (!res.ok && res.status !== 404)) {
      await confirm({ title: 'Could not delete that chat', body: 'Check your connection and try again.', cancelLabel: null });
      return;
    }
    setChats((c) => c?.filter((x) => x.id !== chat.id) ?? null);
    // The row that held focus is gone; keep the keyboard user in the list.
    requestAnimationFrame(() =>
      ((document.querySelector('.recent-item') ?? document.querySelector('.new-chat')) as HTMLElement | null)?.focus(),
    );
    if (chat.id === activeId) router.push('/ask');
  }

  if (chats === null) return <p className="side-empty">Loading…</p>;
  // A chat that never got an answer is noise in the list.
  const visible = chats.filter((c) => c.title && c.title !== 'New chat');
  if (visible.length === 0) return <p className="side-empty">Your conversations will appear here.</p>;

  return (
    <>
    {dialog}
    <ul className="recents-list">
      {visible.map((c) => (
        <li key={c.id} className="recent-row">
          <Link
            href={`/ask?session=${c.id}`}
            className="recent-item"
            aria-current={c.id === activeId ? 'page' : undefined}
            onClick={onNavigate}
          >
            {c.title}
          </Link>
          <button
            type="button"
            className="recent-del"
            aria-label={`Delete chat: ${c.title}`}
            title="Delete chat"
            onClick={() => void remove(c)}
          >
            <TrashIcon size={15} />
          </button>
        </li>
      ))}
    </ul>
    </>
  );
}

// ---- account menu -------------------------------------------------------------

function Account({ user, onNavigate }: { user: ShellUser; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape — what every menu does.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="account" ref={ref}>
      {open && (
        // A disclosure, not role="menu": it holds a radio group, and an ARIA menu
        // promises arrow-key navigation this panel doesn't have.
        <div className="account-menu" id="account-panel">
          <div className="account-menu-head">
            <strong>{user.name || 'You'}</strong>
            <span className="muted">{user.email}</span>
          </div>
          <Link
            href="/profile"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              onNavigate();
            }}
          >
            <ProfileIcon size={18} /> Profile &amp; settings
          </Link>
          <div className="menu-theme">
            <span className="muted">Theme</span>
            <ThemeSwitch name="menu-theme" compact />
          </div>
          <button
            type="button"
            className="menu-item"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await signOut();
              router.push('/login');
              router.refresh();
            }}
          >
            <SignOutIcon size={18} /> {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
      <button
        type="button"
        className="account-btn"
        // The avatar is aria-hidden and the name hides when the sidebar collapses,
        // which left this button with no name at all (2026-11-09 test pass).
        aria-label={`Account — ${user.name || user.email}`}
        aria-controls="account-panel"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden="true">
          {user.initials}
        </span>
        <span className="account-meta label">
          <span className="account-name">{user.name || user.email}</span>
          <span className="account-sub">{user.subtitle}</span>
        </span>
      </button>
    </div>
  );
}

// ---- the frame ----------------------------------------------------------------

export function ShellFrame({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const [drawer, setDrawer] = useState(false);
  const close = useCallback(() => setDrawer(false), []);
  // The pre-paint script sets data-sidebar before React runs; read it after
  // mount so the server render and the first client render agree.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(document.documentElement.dataset.sidebar === 'collapsed'), []);

  // Focus goes into the drawer when it opens, and back to the button that opened
  // it when it is dismissed — not when a link inside it navigates, where the new
  // page's content is the right place to land.
  const openBtn = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const dismiss = useCallback(() => {
    setDrawer(false);
    openBtn.current?.focus();
  }, []);
  useEffect(() => {
    if (drawer) closeBtn.current?.focus();
  }, [drawer]);

  // Navigating closes the drawer; so does Escape.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closing on every path change is the point.
  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismiss();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer, dismiss]);

  const current = FEATURES.find((f) => isActive(pathname, f.href));
  const title = pathname.startsWith('/profile') ? 'Profile' : (current?.name ?? 'Grasp');

  return (
    <div className="shell" data-drawer={drawer ? 'open' : undefined}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {/* Phone top bar */}
      <header className="topbar">
        <button
          ref={openBtn}
          type="button"
          className="icon-btn"
          aria-label="Open navigation"
          aria-expanded={drawer}
          aria-controls="sidebar"
          onClick={() => setDrawer(true)}
        >
          <SidebarIcon size={22} />
        </button>
        <span className="topbar-title">{title}</span>
        <Link href="/ask" className="icon-btn" aria-label="New chat">
          <PlusIcon size={22} />
        </Link>
      </header>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: the scrim is a pointer convenience; Escape and the close button are the accessible ways out. */}
      <div className="scrim" onClick={dismiss} aria-hidden="true" />

      <aside className="sidebar" id="sidebar" aria-label="Grasp">
        <div className="sidebar-head">
          <Link href="/app" className="sidebar-logo" aria-label="Grasp — Today" onClick={close}>
            <span className="label">
              <GraspLogo size={28} />
            </span>
            <span className="collapsed-only">
              <GraspMark size={28} />
            </span>
          </Link>
          <button
            type="button"
            className="icon-btn collapse-btn"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            aria-controls="sidebar"
            onClick={() => setCollapsed(toggleCollapsed())}
          >
            <SidebarIcon size={19} />
          </button>
          <button ref={closeBtn} type="button" className="icon-btn drawer-close" aria-label="Close navigation" onClick={dismiss}>
            <CloseIcon size={20} />
          </button>
        </div>

        <Link href="/ask" className="new-chat" aria-label="New chat" title="New chat" onClick={close}>
          <span className="new-chat-icon" aria-hidden="true">
            <PlusIcon size={16} />
          </span>
          <span className="label">New chat</span>
        </Link>

        <nav className="side-nav" aria-label="Features">
          {FEATURES.map((f) => (
            <Link
              key={f.id}
              href={f.href}
              className="side-link"
              aria-current={isActive(pathname, f.href) ? 'page' : undefined}
              title={f.name}
              onClick={close}
              style={{ ['--feat' as string]: `var(${f.color})`, ['--feat-soft' as string]: `var(${f.soft})` }}
            >
              <span className="side-icon">
                <f.Icon size={20} />
              </span>
              <span className="label">{f.name}</span>
            </Link>
          ))}
        </nav>

        <section className="recents label" aria-label="Recent chats">
          <p className="side-section">Recent chats</p>
          <Suspense fallback={<p className="side-empty">Loading…</p>}>
            <Recents onNavigate={close} />
          </Suspense>
        </section>

        <Account user={user} onNavigate={close} />
      </aside>

      <div className="shell-main" id="main" tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
