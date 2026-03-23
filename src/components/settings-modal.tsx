"use client";

import { useState, useEffect } from "react";
import { X, Eye, EyeOff, Check } from "lucide-react";
import { getApiKey, setApiKey, clearApiKey } from "@/lib/keys";
import type { Provider } from "@/lib/models";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

interface KeyFieldProps {
  label: string;
  provider: Provider;
  placeholder: string;
}

function KeyField({ label, provider, placeholder }: KeyFieldProps) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [visible, setVisible] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);

  useEffect(() => {
    const existing = getApiKey(provider);
    if (existing) {
      setValue(existing);
      setHasExisting(true);
    }
  }, [provider]);

  const handleSave = () => {
    if (value.trim()) {
      setApiKey(provider, value.trim());
      setSaved(true);
      setHasExisting(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleClear = () => {
    clearApiKey(provider);
    setValue("");
    setHasExisting(false);
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-text-primary">{label}</label>
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <input
            type={visible ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors pr-10"
          />
          <button
            onClick={() => setVisible(!visible)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-secondary transition-colors"
          >
            {visible ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <button
          onClick={handleSave}
          className="px-3 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors flex items-center gap-1.5"
        >
          {saved ? <Check size={14} /> : null}
          {saved ? "Saved" : "Save"}
        </button>
        {hasExisting && (
          <button
            onClick={handleClear}
            className="px-3 py-2 rounded-lg border border-border hover:border-danger text-text-muted hover:text-danger text-sm transition-colors"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg mx-4 bg-bg-secondary border border-border rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <h3 className="text-sm font-medium text-text-secondary mb-3">
              API Keys
            </h3>
            <p className="text-xs text-text-muted mb-4">
              Your API keys are stored in your browser&apos;s localStorage. They are
              sent through the app&apos;s API route to call AI providers. For full
              control, self-host this application.
            </p>
            <div className="space-y-4">
              <KeyField
                label="Anthropic"
                provider="anthropic"
                placeholder="sk-ant-..."
              />
              <KeyField
                label="OpenAI"
                provider="openai"
                placeholder="sk-..."
              />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-bg-tertiary hover:bg-border text-sm text-text-primary transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
