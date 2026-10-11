import type { ReactNode } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  LockKeyhole,
  type LucideIcon,
} from "lucide-react";
import { Link } from "./ui";

export function Logo({
  to = "/",
  small = false,
}: {
  to?: string;
  small?: boolean;
}) {
  return (
    <Link to={to} className={`brand ${small ? "small" : ""}`}>
      <img src="/handlio-logo.png" alt="" />
      <span>Handlio</span>
    </Link>
  );
}
export function Metric({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  note: string;
  icon: LucideIcon;
}) {
  return (
    <div className="proto-metric">
      <div>
        <span>{label}</span>
        <Icon size={17} />
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
export function UsageBar({
  label,
  value,
  max,
  unit = "",
}: {
  label: string;
  value: number;
  max: number;
  unit?: string;
}) {
  return (
    <div className="proto-usage">
      <div>
        <span>{label}</span>
        <strong>
          {Number.isInteger(value) ? value : value.toFixed(1)}
          {unit} / {max}
          {unit}
        </strong>
      </div>
      <div className="usage-track">
        <i
          style={{ width: `${Math.min(100, max ? (value / max) * 100 : 0)}%` }}
        />
      </div>
    </div>
  );
}
export function MockCms() {
  return (
    <div className="mockcms" aria-label="Fictional website editor illustration">
      <div className="cmsbar">
        <div className="cmstraffic">
          <i />
          <i />
          <i />
        </div>
        <span className="cmsaddress">
          northstar.example / admin / pages / home
        </span>
        <LockKeyhole size={11} />
      </div>
      <div className="cmsbody">
        <aside className="cmsnav">
          <strong>✳ Northstar</strong>
          <span>Overview</span>
          <span className="active">▤ &nbsp; Pages</span>
          <span>◈ &nbsp; Media library</span>
          <span>◎ &nbsp; Team access</span>
          <span>⚙ &nbsp; Settings</span>
          <small>Sample CMS · not live</small>
        </aside>
        <div className="cmsmain">
          <div className="cmsmain-heading">
            <div>
              <h4>Home page</h4>
              <p>Edit content, then preview your changes.</p>
            </div>
            <span className="cms-save">Save draft</span>
          </div>
          <div className="cmsedit">
            <div>
              <label>PAGE TITLE</label>
              <div className="cmsinput">Home</div>
              <label>HERO HEADING</label>
              <div className="cmsinput highlighted">
                <span className="cmsnumber">2</span>Designing spaces for a
                better everyday.
              </div>
              <label>INTRODUCTION</label>
              <div className="cmsinput cmsparagraph">
                We are Northstar, an independent design studio.
                <br />
                Thoughtful spaces. Lasting connections.
              </div>
            </div>
            <aside>
              <div className="cmssidebox">
                <label>PAGE STATUS</label>
                <span>Draft changes</span>
              </div>
              <div className="cmssidebox">
                <label>COVER IMAGE</label>
                <div className="cmscover" />
                <span>Home page cover</span>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
export function MiniHandbook() {
  return (
    <div className="hero-art">
      <div className="handbook-mini">
        <div className="mini-nav">
          <strong>✳ &nbsp; Northstar</strong>
          <span>v2 · Client handbook</span>
        </div>
        <div className="mini-body">
          <aside className="mini-toc">
            {[
              "01  Getting started",
              "02  Update content",
              "03  Manage media",
              "04  Handoff checklist",
              "05  Get support",
            ].map((t) => (
              <div key={t}>{t}</div>
            ))}
          </aside>
          <div className="mini-content">
            <p className="eyebrow">YOUR WEBSITE, HANDED OVER</p>
            <h3>
              Make your next update
              <br />
              with confidence.
            </h3>
            <p>A clear guide to keeping your website up to date.</p>
            <MockCms />
          </div>
        </div>
      </div>
      <div className="hero-receipt">
        <span>
          <CheckCircle2 size={18} />
        </span>
        <div>
          <strong>Version v2 received</strong>
          <small>A clear record. No more guesswork.</small>
        </div>
      </div>
    </div>
  );
}
