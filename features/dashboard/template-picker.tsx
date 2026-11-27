"use client";

import { Button } from "@/components/ui/button";
import { STARTER_TEMPLATES, type StarterTemplate } from "@/lib/domain/templates";

interface TemplatePickerProps {
  onSelect: (template: StarterTemplate) => void;
  title?: string;
}

export function TemplatePicker({ onSelect, title = "Pilih template usaha kuliner" }: TemplatePickerProps) {
  return (
    <div className="template-picker">
      <div className="template-picker-header">
        <h3>{title}</h3>
        <p>Mulai cepat dengan contoh pemasok, bahan baku, resep, dan skenario mitigasi yang siap disimulasikan.</p>
      </div>
      <div className="template-grid">
        {STARTER_TEMPLATES.map((tpl) => (
          <article key={tpl.id} className="template-card">
            <div className="template-card-body">
              <span className="tag tag-neutral">{tpl.sector}</span>
              <h4>{tpl.name}</h4>
              <p>{tpl.tagline}</p>
              <small className="template-highlight">{tpl.highlight}</small>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label={`Pakai template ${tpl.name}`}
              onClick={() => onSelect(tpl)}
            >
              Pakai Template
            </Button>
          </article>
        ))}
      </div>
    </div>
  );
}
