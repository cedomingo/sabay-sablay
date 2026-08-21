-- Phase 3: CRS-Monitor Enrichment Columns
ALTER TABLE schedule_entries
ADD COLUMN raw_ocr_text TEXT,
ADD COLUMN instructor TEXT,
ADD COLUMN remarks TEXT,
ADD COLUMN restrictions TEXT,
ADD COLUMN match_confidence NUMERIC,
ADD COLUMN match_candidates JSONB;