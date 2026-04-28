-- Fishbowl Advanced Schema: Fulfillment — Pick, Ship, Receipt
-- 17 table(s)
-- Column definitions only. Keys, constraints, and indexes omitted.
-- FK naming convention: fooId -> foo.id  (e.g. customerId -> customer.id)

CREATE TABLE `pick` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateFinished` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `dateScheduled` datetime(6) DEFAULT NULL,
  `dateStarted` datetime(6) DEFAULT NULL,
  `locationGroupId` int NOT NULL,
  `num` varchar(35) NOT NULL,
  `priority` int NOT NULL,
  `statusId` int NOT NULL,
  `toBePrinted` bit(1) NOT NULL DEFAULT TRUE,
  `typeId` int NOT NULL,
  `userId` int NOT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `pickitem` (
  `id` int NOT NULL AUTO_INCREMENT,
  `destTagId` bigint DEFAULT NULL,
  `orderId` int NOT NULL,
  `orderTypeId` int NOT NULL,
  `partId` int NOT NULL,
  `pickId` int NOT NULL,
  `poItemId` int DEFAULT NULL,
  `qty` decimal(28,9) DEFAULT NULL,
  `shipId` int DEFAULT NULL,
  `slotNum` int DEFAULT NULL,
  `soItemId` int DEFAULT NULL,
  `srcLocationId` int DEFAULT NULL,
  `srcTagId` bigint DEFAULT NULL,
  `statusId` int NOT NULL,
  `tagId` bigint DEFAULT NULL,
  `typeId` int NOT NULL,
  `uomId` int NOT NULL,
  `woItemId` int DEFAULT NULL,
  `xoItemId` int DEFAULT NULL
);

CREATE TABLE `pickitemstatus` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `pickitemtype` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `pickstatus` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `picktype` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `receipt` (
  `id` int NOT NULL AUTO_INCREMENT,
  `locationGroupId` int NOT NULL,
  `orderTypeId` int NOT NULL,
  `poId` int DEFAULT NULL,
  `soId` int DEFAULT NULL,
  `statusId` int NOT NULL,
  `typeId` int NOT NULL,
  `userId` int NOT NULL,
  `xoId` int DEFAULT NULL
);

CREATE TABLE `receiptitem` (
  `id` int NOT NULL AUTO_INCREMENT,
  `billVendorFlag` bit(1) NOT NULL,
  `billedTotalCost` decimal(28,9) DEFAULT NULL,
  `mcBilledTotalCost` decimal(28,9) DEFAULT NULL,
  `billedUnitCost` decimal(28,9) DEFAULT NULL,
  `mcBilledUnitCost` decimal(28,9) DEFAULT NULL,
  `carrierId` int DEFAULT NULL,
  `customerId` int DEFAULT NULL,
  `dateBilled` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `dateReceived` datetime(6) DEFAULT NULL,
  `dateReconciled` datetime(6) DEFAULT NULL,
  `deliverTo` varchar(30) DEFAULT NULL,
  `landedTotalCost` decimal(28,9) DEFAULT NULL,
  `mcLandedTotalCost` decimal(28,9) DEFAULT NULL,
  `locationId` int DEFAULT NULL,
  `orderTypeId` int NOT NULL,
  `packageCount` int DEFAULT NULL,
  `partId` int DEFAULT NULL,
  `partTypeId` int NOT NULL,
  `poItemId` int DEFAULT NULL,
  `qty` decimal(28,9) DEFAULT NULL,
  `reason` varchar(90) DEFAULT NULL,
  `receiptId` int NOT NULL,
  `refNo` varchar(20) DEFAULT NULL,
  `responsibilityId` int DEFAULT NULL,
  `shipItemId` int DEFAULT NULL,
  `soItemId` int DEFAULT NULL,
  `statusId` int NOT NULL,
  `tagId` bigint DEFAULT NULL,
  `taxId` int DEFAULT NULL,
  `taxRate` double DEFAULT NULL,
  `trackingNum` varchar(30) DEFAULT NULL,
  `typeId` int NOT NULL,
  `uomId` int NOT NULL,
  `xoItemId` int DEFAULT NULL,
  `outsourcedCost` decimal(28,9) DEFAULT NULL,
  `carrierServiceId` int DEFAULT NULL
);

CREATE TABLE `receiptitemstatus` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `receiptitemtype` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `receiptstatus` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `receipttype` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `ship` (
  `id` int NOT NULL AUTO_INCREMENT,
  `FOBPointId` int DEFAULT NULL,
  `billOfLading` varchar(20) DEFAULT NULL,
  `carrierId` int NOT NULL,
  `carrierServiceId` int DEFAULT NULL,
  `cartonCount` int DEFAULT NULL,
  `contact` varchar(250) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `dateShipped` datetime(6) DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `note` longtext,
  `num` varchar(35) NOT NULL,
  `orderTypeId` int NOT NULL,
  `ownerIsFrom` bit(1) NOT NULL,
  `poId` int DEFAULT NULL,
  `shipToId` int DEFAULT NULL,
  `shipmentIdentificationNumber` varchar(32) DEFAULT NULL,
  `shippedBy` int DEFAULT NULL,
  `soId` int DEFAULT NULL,
  `statusId` int NOT NULL,
  `xoId` int DEFAULT NULL,
  `shipToAddress` varchar(90) DEFAULT NULL,
  `shipToCity` varchar(30) DEFAULT NULL,
  `shipToName` varchar(60) DEFAULT NULL,
  `shipToZip` varchar(10) DEFAULT NULL,
  `shipToCountryId` int DEFAULT NULL,
  `shipToStateId` int DEFAULT NULL,
  `shipToResidential` bit(1) NOT NULL DEFAULT b'0',
  `customFields` json DEFAULT NULL
);

CREATE TABLE `shipcarton` (
  `id` int NOT NULL AUTO_INCREMENT,
  `additionalHandling` bit(1) NOT NULL,
  `carrierId` int NOT NULL,
  `cartonNum` int NOT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `freightAmount` decimal(28,9) DEFAULT NULL,
  `freightWeight` decimal(28,9) DEFAULT NULL,
  `height` decimal(28,9) DEFAULT NULL,
  `insuredValue` decimal(28,9) DEFAULT NULL,
  `len` decimal(28,9) DEFAULT NULL,
  `orderId` int DEFAULT NULL,
  `orderTypeId` int NOT NULL,
  `shipId` int NOT NULL,
  `shipperRelease` bit(1) NOT NULL,
  `sizeUOM` varchar(30) DEFAULT NULL,
  `sscc` varchar(20) DEFAULT NULL,
  `trackingNum` varchar(255) DEFAULT NULL,
  `weightUOM` varchar(32) DEFAULT NULL,
  `width` decimal(28,9) DEFAULT NULL
);

CREATE TABLE `shipitem` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `itemId` int DEFAULT NULL,
  `orderId` int DEFAULT NULL,
  `orderTypeId` int NOT NULL,
  `poItemId` int DEFAULT NULL,
  `qtyShipped` decimal(28,9) DEFAULT NULL,
  `shipCartonId` int NOT NULL,
  `shipId` int NOT NULL,
  `soItemId` int DEFAULT NULL,
  `tagId` bigint DEFAULT NULL,
  `totalCost` decimal(28,9) DEFAULT NULL,
  `uomId` int NOT NULL,
  `xoItemId` int DEFAULT NULL
);

CREATE TABLE `shippingimport` (
  `id` int NOT NULL AUTO_INCREMENT,
  `cartonCost` double DEFAULT NULL,
  `cartonVoid` varchar(1) DEFAULT 'N',
  `cartonWeight` decimal(28,9) DEFAULT NULL,
  `ignoreThis` varchar(255) DEFAULT NULL,
  `shipCartonId` varchar(30) DEFAULT NULL,
  `trackingNum` varchar(255) DEFAULT NULL,
  `processed` bit(1) DEFAULT NULL
);

CREATE TABLE `shipstatus` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);
