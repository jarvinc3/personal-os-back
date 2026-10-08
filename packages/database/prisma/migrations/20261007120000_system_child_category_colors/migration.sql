-- System child categories were seeded without color. Give each one its own
-- swatch, then copy the parent color onto any child that is still blank.

UPDATE "fin_categories" AS child
SET
  "color" = v."color",
  "updated_at" = NOW()
FROM "fin_categories" AS parent
JOIN (
  VALUES
    ('Alimentación', 'Supermercado', '#C2410C'),
    ('Alimentación', 'Restaurantes', '#F97316'),
    ('Alimentación', 'Cafetería', '#FBBF24'),
    ('Alimentación', 'Delivery', '#EA580C'),
    ('Cuidado personal', 'Belleza', '#DB2777'),
    ('Cuidado personal', 'Barbería', '#F472B6'),
    ('Entretenimiento', 'Streaming', '#6366F1'),
    ('Entretenimiento', 'Salidas', '#A78BFA'),
    ('Entretenimiento', 'Viajes', '#38BDF8'),
    ('Hogar', 'Alquiler', '#0F766E'),
    ('Hogar', 'Servicios', '#EAB308'),
    ('Hogar', 'Internet', '#0284C7'),
    ('Hogar', 'Celular', '#14B8A6'),
    ('Ingresos', 'Salario', '#16A34A'),
    ('Ingresos', 'Freelance', '#0EA5E9'),
    ('Ingresos', 'Inversiones', '#7C3AED'),
    ('Ingresos', 'Bonos', '#CA8A04'),
    ('Salud', 'Farmacia', '#E11D48'),
    ('Salud', 'Médico', '#BE185D'),
    ('Salud', 'Gimnasio', '#F43F5E'),
    ('Tecnología', 'Software', '#4F46E5'),
    ('Tecnología', 'Gadgets', '#60A5FA'),
    ('Transporte', 'Gasolina', '#0369A1'),
    ('Transporte', 'Taxi / Uber', '#F59E0B'),
    ('Transporte', 'Estacionamiento', '#64748B')
) AS v("parent_name", "child_name", "color")
  ON parent."name" = v."parent_name"
 AND parent."is_system" = true
 AND parent."parent_id" IS NULL
WHERE child."parent_id" = parent."id"
  AND child."is_system" = true
  AND child."name" = v."child_name"
  AND (child."color" IS NULL OR btrim(child."color") = '');

UPDATE "fin_categories" AS child
SET
  "color" = parent."color",
  "updated_at" = NOW()
FROM "fin_categories" AS parent
WHERE child."parent_id" = parent."id"
  AND (child."color" IS NULL OR btrim(child."color") = '')
  AND parent."color" IS NOT NULL
  AND btrim(parent."color") <> '';
