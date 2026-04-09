import { useEffect, useRef, useState } from 'react';
import logo from '../../assets/logo-32.png';
import './AboutDialog.css';

interface AboutDialogProps {
  visible: boolean;
  onClose: () => void;
}

export function AboutDialog({ visible, onClose }: AboutDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState('1.0.0');

  useEffect(() => {
    window.pennivo?.getAppInfo?.().then((info) => {
      if (info?.version) setVersion(info.version);
    });
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [visible, onClose]);

  if (!visible) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const handleLinkClick = (url: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    window.pennivo?.openExternal(url);
  };

  return (
    <div className="about-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="about-card" role="dialog" aria-label="About Pennivo">
        <img src={logo} alt="Pennivo" className="about-logo" />
        <div className="about-name">Pennivo</div>
        <div className="about-version">Version {version}</div>
        <div className="about-desc">Markdown, modernized.</div>
        <hr className="about-divider" />
        <div className="about-meta">
          <div>&copy; 2026 Paya Ebrahimi</div>
          <div>Licensed under MIT</div>
          <div>
            <a
              className="about-link"
              href="https://github.com/payaeb/pennivo"
              onClick={handleLinkClick('https://github.com/payaeb/pennivo')}
            >
              GitHub
            </a>
          </div>
        </div>
        <button className="about-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
