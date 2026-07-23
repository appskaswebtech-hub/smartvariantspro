-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ShopSetting" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "widgetLayout" TEXT NOT NULL DEFAULT 'radio',
    "themeColor" TEXT NOT NULL DEFAULT '#111111',
    "optionStyles" TEXT NOT NULL DEFAULT '{}',
    "showPrice" BOOLEAN NOT NULL DEFAULT true,
    "showAvailability" BOOLEAN NOT NULL DEFAULT true,
    "showQuantity" BOOLEAN NOT NULL DEFAULT true,
    "showAddToCart" BOOLEAN NOT NULL DEFAULT true,
    "addToCartLabel" TEXT NOT NULL DEFAULT 'Add to cart',
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ShopSetting" ("addToCartLabel", "optionStyles", "shop", "showAvailability", "showPrice", "themeColor", "updatedAt", "widgetLayout") SELECT "addToCartLabel", "optionStyles", "shop", "showAvailability", "showPrice", "themeColor", "updatedAt", "widgetLayout" FROM "ShopSetting";
DROP TABLE "ShopSetting";
ALTER TABLE "new_ShopSetting" RENAME TO "ShopSetting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
