-- Fishbowl Advanced Schema: Parts & Products — Part, Product, BOM, Kit, UOM
-- 23 table(s)
-- Column definitions only. Keys, constraints, and indexes omitted.
-- FK naming convention: fooId -> foo.id  (e.g. customerId -> customer.id)

CREATE TABLE `bom` (
  `id` int NOT NULL AUTO_INCREMENT,
  `activeFlag` bit(1) NOT NULL,
  `autoCreateTypeId` int DEFAULT NULL,
  `configurable` bit(1) NOT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `defaultCalCategoryId` int DEFAULT NULL,
  `description` varchar(252) NOT NULL,
  `estimatedDuration` int DEFAULT NULL,
  `note` longtext,
  `num` varchar(70) NOT NULL,
  `pickFromLocation` bit(1) NOT NULL,
  `qbClassId` int DEFAULT NULL,
  `revision` varchar(31) NOT NULL,
  `statisticsDateRange` varchar(41) DEFAULT NULL,
  `url` varchar(256) NOT NULL,
  `userId` int NOT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `bomautocreatetype` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `bominstructionitem` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `bomId` int NOT NULL,
  `description` varchar(256) DEFAULT NULL,
  `details` longtext,
  `name` varchar(256) NOT NULL,
  `sortOrder` int NOT NULL,
  `url` varchar(256) DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `bomitem` (
  `id` int NOT NULL AUTO_INCREMENT,
  `addToService` bit(1) NOT NULL,
  `bomId` int NOT NULL,
  `bomItemGroupId` int DEFAULT NULL,
  `description` varchar(256) NOT NULL,
  `groupDefault` bit(1) NOT NULL,
  `maxQty` decimal(28,9) DEFAULT NULL,
  `minQty` decimal(28,9) DEFAULT NULL,
  `oneTimeItem` bit(1) NOT NULL,
  `partId` int DEFAULT NULL,
  `priceAdjustment` decimal(28,9) DEFAULT NULL,
  `productId` int DEFAULT NULL,
  `quantity` decimal(28,9) NOT NULL,
  `sortIdConfig` int NOT NULL,
  `stage` bit(1) NOT NULL,
  `stageBomId` int DEFAULT NULL,
  `typeId` int NOT NULL,
  `uomId` int DEFAULT NULL,
  `useItemLocation` bit(1) NOT NULL,
  `variableQty` bit(1) NOT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `bomitemgroup` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bomId` int NOT NULL,
  `name` varchar(70) NOT NULL,
  `prompt` varchar(256) DEFAULT NULL,
  `sortOrder` int NOT NULL
);

CREATE TABLE `bomitemtolocation` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bomItemId` int NOT NULL,
  `locationGroupId` int NOT NULL,
  `locationId` int NOT NULL
);

CREATE TABLE `bomitemtype` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `bomtolocation` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bomId` int NOT NULL,
  `locationGroupId` int NOT NULL,
  `locationId` int NOT NULL
);

CREATE TABLE `kitdisplaytype` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `kititem` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `defaultQty` decimal(28,9) NOT NULL,
  `description` varchar(256) DEFAULT NULL,
  `discountId` int DEFAULT NULL,
  `kitItemTypeId` int NOT NULL,
  `kitProductId` int NOT NULL,
  `kitTypeId` int NOT NULL,
  `maxQty` decimal(28,9) NOT NULL,
  `minQty` decimal(28,9) NOT NULL,
  `note` longtext,
  `productId` int DEFAULT NULL,
  `qtyPriceAdjustment` decimal(28,9) DEFAULT NULL,
  `soItemTypeId` int DEFAULT NULL,
  `sortOrder` int DEFAULT NULL,
  `taxRateId` int DEFAULT NULL,
  `uomId` int DEFAULT NULL
);

CREATE TABLE `kititemtype` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `kitoption` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `defaultFlag` bit(1) NOT NULL,
  `kitItemId` int NOT NULL,
  `priceAdjustment` decimal(28,9) DEFAULT NULL,
  `productId` int NOT NULL
);

CREATE TABLE `kittype` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `part` (
  `id` int NOT NULL AUTO_INCREMENT,
  `abcCode` varchar(1) DEFAULT NULL,
  `accountingHash` varchar(30) DEFAULT NULL,
  `accountingId` varchar(36) DEFAULT NULL,
  `activeFlag` bit(1) NOT NULL,
  `adjustmentAccountId` int DEFAULT NULL,
  `alertNote` varchar(256) DEFAULT NULL,
  `alwaysManufacture` bit(1) NOT NULL,
  `cogsAccountId` int DEFAULT NULL,
  `configurable` bit(1) NOT NULL,
  `consumptionRate` decimal(28,9) NOT NULL DEFAULT '0.000000000',
  `controlledFlag` bit(1) NOT NULL,
  `cycleCountTol` decimal(28,9) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `defaultBomId` int DEFAULT NULL,
  `defaultOutsourcedReturnItemId` int DEFAULT NULL,
  `defaultPoItemTypeId` int DEFAULT NULL,
  `defaultProductId` int DEFAULT NULL,
  `description` varchar(252) DEFAULT NULL,
  `details` longtext,
  `height` decimal(28,9) DEFAULT NULL,
  `inventoryAccountId` int DEFAULT NULL,
  `lastChangedUser` varchar(100) DEFAULT NULL,
  `leadTime` int DEFAULT NULL,
  `len` decimal(28,9) DEFAULT NULL,
  `num` varchar(70) NOT NULL,
  `partClassId` int DEFAULT NULL,
  `pickInUomOfPart` bit(1) NOT NULL,
  `receivingTol` decimal(28,9) DEFAULT NULL,
  `revision` varchar(15) DEFAULT NULL,
  `scrapAccountId` int DEFAULT NULL,
  `serializedFlag` bit(1) NOT NULL,
  `sizeUomId` int DEFAULT NULL,
  `stdCost` decimal(28,9) DEFAULT NULL,
  `taxId` int DEFAULT NULL,
  `trackingFlag` bit(1) NOT NULL,
  `typeId` int NOT NULL,
  `uomId` int NOT NULL,
  `upc` varchar(31) DEFAULT NULL,
  `url` varchar(256) DEFAULT NULL,
  `varianceAccountId` int DEFAULT NULL,
  `weight` decimal(28,9) DEFAULT NULL,
  `weightUomId` int DEFAULT NULL,
  `width` decimal(28,9) DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `partcategory` (
  `id` int NOT NULL AUTO_INCREMENT,
  `description` varchar(256) NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `parttype` (
  `id` int NOT NULL,
  `name` varchar(30) DEFAULT NULL
);

CREATE TABLE `product` (
  `id` int NOT NULL AUTO_INCREMENT,
  `accountingHash` varchar(30) DEFAULT NULL,
  `accountingId` varchar(36) DEFAULT NULL,
  `activeFlag` bit(1) NOT NULL,
  `alertNote` varchar(256) DEFAULT NULL,
  `cartonCount` decimal(28,9) NOT NULL DEFAULT '0.000000000',
  `defaultCartonTypeId` int DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `defaultSoItemType` int NOT NULL,
  `description` varchar(252) DEFAULT NULL,
  `details` longtext,
  `displayTypeId` int DEFAULT NULL,
  `height` decimal(28,9) DEFAULT NULL,
  `incomeAccountId` int DEFAULT NULL,
  `kitFlag` bit(1) NOT NULL,
  `kitGroupedFlag` bit(1) NOT NULL,
  `len` decimal(28,9) DEFAULT NULL,
  `num` varchar(70) NOT NULL,
  `partId` int DEFAULT NULL,
  `price` decimal(28,9) DEFAULT NULL,
  `qbClassId` int DEFAULT NULL,
  `sellableInOtherUoms` bit(1) NOT NULL,
  `showSoComboFlag` bit(1) NOT NULL,
  `sizeUomId` int DEFAULT NULL,
  `sku` varchar(31) DEFAULT NULL,
  `taxId` int DEFAULT NULL,
  `taxableFlag` bit(1) NOT NULL,
  `uomId` int NOT NULL,
  `upc` varchar(31) DEFAULT NULL,
  `url` varchar(256) DEFAULT NULL,
  `usePriceFlag` bit(1) NOT NULL,
  `weight` decimal(28,9) DEFAULT NULL,
  `weightUomId` int DEFAULT NULL,
  `width` decimal(28,9) DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `productincltype` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `producttotree` (
  `id` int NOT NULL AUTO_INCREMENT,
  `productId` int NOT NULL,
  `productTreeId` int NOT NULL
);

CREATE TABLE `producttree` (
  `id` int NOT NULL AUTO_INCREMENT,
  `description` varchar(256) DEFAULT NULL,
  `name` varchar(30) NOT NULL,
  `parentId` int NOT NULL
);

CREATE TABLE `uom` (
  `id` int NOT NULL AUTO_INCREMENT,
  `activeFlag` bit(1) NOT NULL,
  `code` varchar(10) NOT NULL,
  `defaultRecord` bit(1) NOT NULL,
  `description` varchar(256) NOT NULL,
  `integral` bit(1) NOT NULL,
  `name` varchar(30) NOT NULL,
  `readOnly` bit(1) NOT NULL,
  `uomType` int NOT NULL
);

CREATE TABLE `uomconversion` (
  `id` int NOT NULL AUTO_INCREMENT,
  `description` varchar(256) NOT NULL,
  `factor` double DEFAULT NULL,
  `fromUomId` int NOT NULL,
  `multiply` double DEFAULT NULL,
  `toUomId` int NOT NULL
);

CREATE TABLE `uomtype` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(15) NOT NULL
);
