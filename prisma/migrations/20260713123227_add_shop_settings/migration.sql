-- CreateTable
CREATE TABLE "ShopSetting" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "widgetLayout" TEXT NOT NULL DEFAULT 'buttons',
    "showPrice" BOOLEAN NOT NULL DEFAULT true,
    "showAvailability" BOOLEAN NOT NULL DEFAULT true,
    "addToCartLabel" TEXT NOT NULL DEFAULT 'Add to cart',
    "updatedAt" DATETIME NOT NULL
);
