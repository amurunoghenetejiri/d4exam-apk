-- Optional OCR / converted-text fields for course materials.
-- Original files remain untouched. Columns are nullable and backward-compatible.

ALTER TABLE public.course_materials
  ADD COLUMN IF NOT EXISTS ocr_text text;

ALTER TABLE public.course_materials
  ADD COLUMN IF NOT EXISTS ocr_status text;

ALTER TABLE public.course_materials
  ADD COLUMN IF NOT EXISTS converted_pdf_url text;

COMMENT ON COLUMN public.course_materials.ocr_text IS
  'Editable computer text from handwriting/OCR conversion. Original file_url is never overwritten.';
COMMENT ON COLUMN public.course_materials.ocr_status IS
  'none | pending | done | failed';
