-- Landing hero background photos as an admin-managed list of image URLs.
-- Additive only: no existing rows or files are changed or removed.

-- 1) Ordered list of hero image URLs on the settings singleton (id = 1).
--    Empty = the landing keeps using the two legacy files in kol-uploads/landing/.
ALTER TABLE talent_settings
  ADD COLUMN IF NOT EXISTS hero_image_urls text[] NOT NULL DEFAULT '{}';

-- 2) Public bucket for landing assets (stable, cacheable URLs). Written only by the
--    backend's service role; public buckets serve /object/public/ reads without policies.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('landing-assets', 'landing-assets', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- 3) The two legacy photos are COPIED (not moved) into landing-assets and added to
--    hero_image_urls from /admin/landing ("Add old photos to the list"), since object
--    bytes can't be copied in SQL. The originals in kol-uploads stay untouched.
