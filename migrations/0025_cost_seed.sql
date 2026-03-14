-- Migration: Seed cost data from Excel "Precios RPYM.xlsx"
-- Tasas al momento de la migración: BCV 446.81, Paralela 625

-- Initial cost settings
INSERT INTO cost_settings (bcv_rate, parallel_rate, iva_rate, debit_commission, credit_commission, notes)
VALUES (446.81, 625.00, 0.08, 0.008, 0.032, 'Migración inicial desde Excel');

-- Bag prices
INSERT INTO bag_prices (bag_type, price_per_thousand_usd, price_per_unit_usd) VALUES
('Bolsa 2kg', 7.00, 0.007),
('Bolsa 3kg', 9.50, 0.0095),
('Bolsa 5kg', 12.00, 0.012),
('Bolsa 10kg', 15.00, 0.015),
('Bolsa 1kg blancas', 10.00, 0.01);

-- Product costs (matched by product name)
-- Camarones
INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 5.50, 'PARALELO' FROM products WHERE nombre LIKE 'Camarón Vivito%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 6.00, 'PARALELO' FROM products WHERE nombre LIKE 'Camarón Jumbo%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 8.33, 'PARALELO' FROM products WHERE nombre LIKE 'Camarón Pelado%' OR nombre LIKE 'Camarón Desvenado' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 8.89, 'PARALELO' FROM products WHERE nombre LIKE 'Camarón Desvenado Jumbo%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 8.50, 'PARALELO' FROM products WHERE nombre LIKE 'Calamar Pota%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 9.20, 'BCV' FROM products WHERE nombre LIKE 'Calamar Nacional' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 12.50, 'BCV' FROM products WHERE nombre LIKE 'Calamar Nacional Grande%' OR nombre LIKE 'Aros de Calamar%' OR nombre LIKE 'Cuerpo de Calamar%' LIMIT 1;

-- Cajas de camarón (precios por caja de 10x2kg)
INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 138.00, 'PARALELO' FROM products WHERE nombre LIKE '%61/70%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 144.00, 'PARALELO' FROM products WHERE nombre LIKE '%51/60%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 150.00, 'PARALELO' FROM products WHERE nombre LIKE '%41/50%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 160.00, 'PARALELO' FROM products WHERE nombre LIKE '%36/40%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 180.00, 'PARALELO' FROM products WHERE nombre LIKE '%31/35%' LIMIT 1;

-- Otros camarones
INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 8.00, 'PARALELO' FROM products WHERE nombre LIKE 'Camarón Pre%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 10.50, 'BCV' FROM products WHERE nombre LIKE 'Langostino%' LIMIT 1;

-- Mariscos
INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 1.26, 'PARALELO' FROM products WHERE nombre = 'Pepitona' OR (nombre LIKE 'Pepitona%' AND nombre NOT LIKE '%Caja%') LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 22.00, 'BCV' FROM products WHERE nombre LIKE 'Pepitona%Caja%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 10.00, 'PARALELO' FROM products WHERE nombre LIKE 'Pulpo Pequ%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 12.00, 'PARALELO' FROM products WHERE nombre LIKE 'Pulpo Mediano%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 12.00, 'PARALELO' FROM products WHERE nombre LIKE 'Pulpo Grande%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 3.50, 'PARALELO' FROM products WHERE nombre LIKE 'Mejillón%Concha%' OR nombre LIKE 'Mejillon%Concha%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 5.80, 'PARALELO' FROM products WHERE nombre LIKE 'Mejillón Pelado%' OR nombre LIKE 'Mejillon Pelado%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 2.50, 'BCV' FROM products WHERE nombre LIKE 'Jaiba%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 1.80, 'PARALELO' FROM products WHERE nombre LIKE 'Guacuco%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 1.96, 'PARALELO' FROM products WHERE nombre LIKE 'Almeja%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 4.30, 'PARALELO' FROM products WHERE nombre LIKE 'Kigua%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 2.90, 'PARALELO' FROM products WHERE nombre LIKE 'Vaquita%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 9.90, 'BCV' FROM products WHERE nombre LIKE 'Viera%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 11.10, 'BCV' FROM products WHERE nombre LIKE 'Tentáculo%' OR nombre LIKE 'Tentaculo%' LIMIT 1;

-- Especiales
INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 24.52, 'BCV' FROM products WHERE nombre LIKE '%Salmón%' OR nombre LIKE '%Salmon%' LIMIT 1;

INSERT OR IGNORE INTO product_costs (product_id, cost_usd, purchase_rate_type)
SELECT id, 1.25, 'PARALELO' FROM products WHERE nombre LIKE 'Pulpa de Cangrejo%' LIMIT 1;
