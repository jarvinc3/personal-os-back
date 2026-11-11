INSERT INTO public.modules (id, slug, key, name, sort_order)
VALUES (
  '00000000-0000-4000-8000-000000000005',
  'ai',
  'AI',
  'Inteligencia',
  5
)
ON CONFLICT (slug) DO NOTHING;
