-- Fix for D1 daily row-read quota exhaustion (2026-09-14)
-- Root cause: WITH picked AS (...) query in similar/related products block
-- did a near-full SCAN of `products` per category due to missing index
-- covering WHERE category=? + ORDER BY in_stock DESC, pid.
-- Rows read/returned ratio was 246:1 (3.69M rows read across 1876 calls, 48.2% of runtime).

-- 1. Covering index for the `picked` CTE: category filter + sort order
CREATE INDEX IF NOT EXISTS idx_products_cat_stock_pid
ON products(category, in_stock DESC, pid);

-- 2. Supporting index for the join + filter on product_content
CREATE INDEX IF NOT EXISTS idx_content_pid_visible
ON product_content(pid, visible, group_id);

-- Verify after applying:
-- EXPLAIN QUERY PLAN
-- WITH picked AS (
--   SELECT
--     pr.pid AS pid,
--     COALESCE(NULLIF(c.display_name, ''), pr.name) AS name,
--     c.slug,
--     pr.price,
--     pr.in_stock
--   FROM products pr
--   JOIN product_content c ON c.pid = pr.pid
--   WHERE
--     pr.category = 'SOME_CATEGORY'
--     AND c.visible = 1
--     AND pr.pid <> 0
--     AND (
--       '' = ''
--       OR c.group_id IS NULL
--       OR c.group_id <> ''
--     )
--   ORDER BY pr.in_stock DESC, pr.pid
--   LIMIT 8
-- )
-- SELECT
--   picked.*,
--   (SELECT path FROM product_images i WHERE i.pid = picked.pid ORDER BY sort LIMIT 1) AS img
-- FROM picked;
--
-- Expected: "SEARCH pr USING INDEX idx_products_cat_stock_pid" instead of "SCAN pr".
