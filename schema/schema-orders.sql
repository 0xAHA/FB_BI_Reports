-- Fishbowl Advanced Schema: Orders — SO, PO, MO, WO, XO, RMA
-- 30 table(s)
-- Column definitions only. Keys, constraints, and indexes omitted.
-- FK naming convention: fooId -> foo.id  (e.g. customerId -> customer.id)

CREATE TABLE `mo` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dateCompleted` datetime(6) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateIssued` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `dateScheduled` datetime(6) DEFAULT NULL,
  `locationGroupId` int NOT NULL,
  `note` longtext,
  `num` varchar(25) NOT NULL,
  `qbClassId` int DEFAULT NULL,
  `revision` int NOT NULL,
  `soId` int DEFAULT NULL,
  `statusId` int NOT NULL,
  `url` varchar(256) DEFAULT NULL,
  `userId` int NOT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `moitem` (
  `id` int NOT NULL AUTO_INCREMENT,
  `addToService` bit(1) NOT NULL,
  `bomId` int DEFAULT NULL,
  `bomItemId` int DEFAULT NULL,
  `dateScheduled` datetime(6) DEFAULT NULL,
  `dateScheduledToStart` datetime(6) DEFAULT NULL,
  `description` varchar(256) NOT NULL,
  `instructionNote` longtext,
  `moId` int DEFAULT NULL,
  `oneTimeItem` bit(1) NOT NULL,
  `parentId` int DEFAULT NULL,
  `partId` int DEFAULT NULL,
  `priceAdjustment` decimal(28,9) DEFAULT NULL,
  `priorityId` int DEFAULT NULL,
  `qbClassId` int DEFAULT NULL,
  `qtyFulfilled` decimal(28,9) DEFAULT NULL,
  `qtyToFulfill` decimal(28,9) DEFAULT NULL,
  `soItemId` int DEFAULT NULL,
  `sortIdInstruct` int NOT NULL,
  `stage` bit(1) NOT NULL,
  `stageLevel` int DEFAULT NULL,
  `statusId` int NOT NULL,
  `totalCost` decimal(28,9) DEFAULT NULL,
  `typeId` int NOT NULL,
  `uomId` int DEFAULT NULL,
  `calCategoryId` int DEFAULT NULL
);

CREATE TABLE `moitemstatus` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `mostatus` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `po` (
  `id` int NOT NULL AUTO_INCREMENT,
  `buyer` varchar(100) DEFAULT NULL,
  `buyerId` int NOT NULL,
  `carrierId` int NOT NULL,
  `carrierServiceId` int DEFAULT NULL,
  `currencyId` int DEFAULT NULL,
  `currencyRate` decimal(28,9) DEFAULT NULL,
  `customerSO` varchar(25) DEFAULT NULL,
  `dateCompleted` datetime(6) DEFAULT NULL,
  `dateConfirmed` datetime(6) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateFirstShip` datetime(6) DEFAULT NULL,
  `dateIssued` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `dateRevision` datetime(6) DEFAULT NULL,
  `deliverTo` varchar(30) DEFAULT NULL,
  `email` varchar(256) DEFAULT NULL,
  `fobPointId` int NOT NULL,
  `issuedByUserId` int DEFAULT NULL,
  `locationGroupId` int NOT NULL,
  `note` longtext,
  `num` varchar(25) NOT NULL,
  `paymentTermsId` int NOT NULL,
  `phone` varchar(256) DEFAULT NULL,
  `qbClassId` int DEFAULT NULL,
  `remitAddress` varchar(90) DEFAULT NULL,
  `remitCity` varchar(30) DEFAULT NULL,
  `remitCountryId` int DEFAULT NULL,
  `remitStateId` int DEFAULT NULL,
  `remitToName` varchar(60) DEFAULT NULL,
  `remitZip` varchar(10) DEFAULT NULL,
  `revisionNum` int DEFAULT NULL,
  `shipTermsId` int NOT NULL,
  `shipToAddress` varchar(90) DEFAULT NULL,
  `shipToCity` varchar(30) DEFAULT NULL,
  `shipToCountryId` int DEFAULT NULL,
  `shipToName` varchar(60) DEFAULT NULL,
  `shipToStateId` int DEFAULT NULL,
  `shipToZip` varchar(10) DEFAULT NULL,
  `statusId` int NOT NULL,
  `taxRateId` int DEFAULT NULL,
  `taxRateName` varchar(31) DEFAULT NULL,
  `totalIncludesTax` bit(1) NOT NULL,
  `totalTax` decimal(28,9) DEFAULT NULL,
  `typeId` int NOT NULL,
  `url` varchar(256) DEFAULT NULL,
  `username` varchar(100) DEFAULT NULL,
  `vendorContact` varchar(30) DEFAULT NULL,
  `vendorId` int NOT NULL,
  `vendorSO` varchar(25) DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `poitem` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customerId` int DEFAULT NULL,
  `dateLastFulfillment` datetime(6) DEFAULT NULL,
  `dateScheduledFulfillment` datetime(6) NOT NULL,
  `description` varchar(256) DEFAULT NULL,
  `mcTotalCost` decimal(28,9) DEFAULT NULL,
  `mcUnitCost` decimal(28,9) DEFAULT NULL,
  `note` longtext,
  `partId` int DEFAULT NULL,
  `outsourcedPartId` int DEFAULT NULL,
  `partNum` varchar(70) NOT NULL,
  `poId` int NOT NULL,
  `poLineItem` int NOT NULL,
  `qbClassId` int DEFAULT NULL,
  `qtyFulfilled` decimal(28,9) DEFAULT NULL,
  `qtyPicked` decimal(28,9) DEFAULT NULL,
  `qtyToFulfill` decimal(28,9) DEFAULT NULL,
  `repairFlag` bit(1) NOT NULL,
  `revLevel` varchar(15) DEFAULT NULL,
  `statusId` int NOT NULL,
  `taxId` int DEFAULT NULL,
  `taxRate` double NOT NULL,
  `tbdCostFlag` bit(1) NOT NULL,
  `totalCost` decimal(28,9) DEFAULT NULL,
  `typeId` int NOT NULL,
  `unitCost` decimal(28,9) DEFAULT NULL,
  `uomId` int DEFAULT NULL,
  `vendorPartNum` varchar(70) NOT NULL,
  `outsourcedPartNumber` varchar(70) NOT NULL,
  `outsourcedPartDescription` varchar(256) NOT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `poitemstatus` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `poitemtype` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `potype` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `rma` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customerId` int NOT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateExpires` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `locationGroupId` int NOT NULL,
  `num` varchar(25) NOT NULL,
  `statusId` int NOT NULL,
  `userId` int NOT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `rmaitem` (
  `id` int NOT NULL AUTO_INCREMENT,
  `crossShipFlag` bit(1) NOT NULL,
  `dateResolved` datetime(6) DEFAULT NULL,
  `issueId` int DEFAULT NULL,
  `lineNum` int NOT NULL,
  `note` longtext,
  `productId` int NOT NULL,
  `productSubId` int DEFAULT NULL,
  `qty` decimal(28,9) DEFAULT NULL,
  `resolutionId` int DEFAULT NULL,
  `returnFlag` bit(1) NOT NULL,
  `rmaId` int NOT NULL,
  `shipFlag` bit(1) NOT NULL,
  `typeId` int NOT NULL,
  `uomId` int NOT NULL,
  `vendorId` int DEFAULT NULL,
  `vendorRMA` varchar(25) DEFAULT NULL
);

CREATE TABLE `rmaitemtype` (
  `id` int NOT NULL,
  `activeFlag` bit(1) NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `rmastatus` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `so` (
  `id` int NOT NULL AUTO_INCREMENT,
  `billToAddress` varchar(90) DEFAULT NULL,
  `billToCity` varchar(30) DEFAULT NULL,
  `billToCountryId` int DEFAULT NULL,
  `billToName` varchar(60) DEFAULT NULL,
  `billToStateId` int DEFAULT NULL,
  `billToZip` varchar(10) DEFAULT NULL,
  `calCategoryId` int DEFAULT NULL,
  `carrierId` int NOT NULL,
  `carrierServiceId` int DEFAULT NULL,
  `cost` decimal(28,9) DEFAULT NULL,
  `createdByUserId` int DEFAULT NULL,
  `currencyId` int DEFAULT NULL,
  `currencyRate` decimal(28,9) DEFAULT NULL,
  `customerContact` varchar(30) DEFAULT NULL,
  `customerId` int NOT NULL,
  `customerPO` varchar(25) DEFAULT NULL,
  `dateCalStart` datetime(6) DEFAULT NULL,
  `dateCalEnd` datetime(6) DEFAULT NULL,
  `dateCompleted` datetime(6) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateExpired` datetime(6) DEFAULT NULL,
  `dateFirstShip` datetime(6) DEFAULT NULL,
  `dateIssued` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `dateRevision` datetime(6) DEFAULT NULL,
  `email` varchar(256) DEFAULT NULL,
  `estimatedTax` decimal(28,9) DEFAULT NULL,
  `fobPointId` int NOT NULL,
  `locationGroupId` int NOT NULL,
  `mcTotalTax` decimal(28,9) DEFAULT NULL,
  `note` longtext,
  `num` varchar(25) NOT NULL,
  `paymentLink` varchar(256) DEFAULT NULL,
  `paymentTermsId` int NOT NULL,
  `phone` varchar(256) DEFAULT NULL,
  `priorityId` int NOT NULL,
  `qbClassId` int DEFAULT NULL,
  `registerId` int DEFAULT NULL,
  `shipToResidential` bit(1) NOT NULL,
  `revisionNum` int DEFAULT NULL,
  `salesman` varchar(100) DEFAULT NULL,
  `salesmanId` int NOT NULL,
  `salesmanInitials` varchar(5) DEFAULT NULL,
  `shipTermsId` int DEFAULT NULL,
  `shipToAddress` varchar(90) DEFAULT NULL,
  `shipToCity` varchar(30) DEFAULT NULL,
  `shipToCountryId` int DEFAULT NULL,
  `shipToName` varchar(60) DEFAULT NULL,
  `shipToStateId` int DEFAULT NULL,
  `shipToZip` varchar(10) DEFAULT NULL,
  `statusId` int NOT NULL,
  `taxRate` double DEFAULT NULL,
  `taxRateId` int DEFAULT NULL,
  `taxRateName` varchar(31) DEFAULT NULL,
  `toBeEmailed` bit(1) NOT NULL,
  `toBePrinted` bit(1) NOT NULL,
  `totalIncludesTax` bit(1) NOT NULL,
  `totalTax` decimal(28,9) DEFAULT NULL,
  `subTotal` decimal(28,9) NOT NULL DEFAULT '0.000000000',
  `totalPrice` decimal(28,9) NOT NULL DEFAULT '0.000000000',
  `typeId` int NOT NULL,
  `url` varchar(256) DEFAULT NULL,
  `username` varchar(100) DEFAULT NULL,
  `vendorPO` varchar(25) DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `soitem` (
  `id` int NOT NULL AUTO_INCREMENT,
  `adjustAmount` decimal(28,9) DEFAULT NULL,
  `adjustPercentage` decimal(28,9) DEFAULT NULL,
  `customerPartNum` varchar(70) DEFAULT NULL,
  `dateLastFulfillment` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `dateScheduledFulfillment` datetime(6) NOT NULL,
  `description` varchar(256) DEFAULT NULL,
  `exchangeSOLineItem` int DEFAULT NULL,
  `itemAdjustId` int DEFAULT NULL,
  `markupCost` decimal(28,9) DEFAULT NULL,
  `mcTotalPrice` decimal(28,9) DEFAULT NULL,
  `note` longtext,
  `priceLocked` bit(1) NOT NULL DEFAULT b'0',
  `productId` int DEFAULT NULL,
  `productNum` varchar(70) NOT NULL,
  `qbClassId` int DEFAULT NULL,
  `qtyFulfilled` decimal(28,9) DEFAULT NULL,
  `qtyOrdered` decimal(28,9) DEFAULT NULL,
  `qtyPicked` decimal(28,9) DEFAULT NULL,
  `qtyToFulfill` decimal(28,9) DEFAULT NULL,
  `revLevel` varchar(15) DEFAULT NULL,
  `showItemFlag` bit(1) NOT NULL,
  `soId` int NOT NULL,
  `soLineItem` int NOT NULL,
  `statusId` int NOT NULL,
  `taxId` int DEFAULT NULL,
  `taxRate` double DEFAULT NULL,
  `taxableFlag` bit(1) NOT NULL,
  `totalCost` decimal(28,9) DEFAULT NULL,
  `totalPrice` decimal(28,9) DEFAULT NULL,
  `typeId` int NOT NULL,
  `unitPrice` decimal(28,9) DEFAULT NULL,
  `uomId` int DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `soitemstatus` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `soitemtype` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `sostatus` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `sotype` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `wo` (
  `id` int NOT NULL AUTO_INCREMENT,
  `calCategoryId` int DEFAULT NULL,
  `cost` decimal(28,9) DEFAULT NULL,
  `customerId` int DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateFinished` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `dateScheduled` datetime(6) DEFAULT NULL,
  `dateScheduledToStart` datetime(6) DEFAULT NULL,
  `dateStarted` datetime(6) DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `locationId` int DEFAULT NULL,
  `moItemId` int NOT NULL,
  `note` longtext,
  `num` varchar(30) NOT NULL,
  `priorityId` int NOT NULL,
  `qbClassId` int DEFAULT NULL,
  `qtyOrdered` int DEFAULT NULL,
  `qtyScrapped` int DEFAULT NULL,
  `qtyTarget` int DEFAULT NULL,
  `statusId` int NOT NULL,
  `userId` int NOT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `woassignedusers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `woId` int NOT NULL
);

CREATE TABLE `woinstruction` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `bomInstructionItemId` bigint DEFAULT NULL,
  `dateFirstReady` datetime(6) DEFAULT NULL,
  `dateLastFulfilled` datetime(6) DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `details` longtext,
  `name` varchar(256) NOT NULL,
  `qtyFulfilled` int DEFAULT '0',
  `qtyReady` int DEFAULT '0',
  `sortOrder` int NOT NULL,
  `url` varchar(256) DEFAULT NULL,
  `woId` int NOT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `woitem` (
  `id` int NOT NULL AUTO_INCREMENT,
  `cost` decimal(28,9) DEFAULT NULL,
  `standardCost` decimal(28,9) DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `moItemId` int NOT NULL,
  `partId` int DEFAULT NULL,
  `qtyScrapped` decimal(28,9) DEFAULT NULL,
  `qtyTarget` decimal(28,9) DEFAULT NULL,
  `qtyUsed` decimal(28,9) DEFAULT NULL,
  `sortId` int NOT NULL,
  `typeId` int DEFAULT NULL,
  `uomId` int DEFAULT NULL,
  `woId` int NOT NULL,
  `oneTimeItem` tinyint NOT NULL DEFAULT '0'
);

CREATE TABLE `wostatus` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `xo` (
  `id` int NOT NULL AUTO_INCREMENT,
  `carrierId` int NOT NULL,
  `carrierServiceId` int DEFAULT NULL,
  `dateCompleted` datetime(6) DEFAULT NULL,
  `dateConfirmed` datetime(6) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateFirstShip` datetime(6) DEFAULT NULL,
  `dateIssued` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `dateScheduled` datetime(6) DEFAULT NULL,
  `fromAddress` varchar(90) DEFAULT NULL,
  `fromAttn` varchar(60) DEFAULT NULL,
  `fromCity` varchar(30) DEFAULT NULL,
  `fromCountryId` int DEFAULT NULL,
  `fromLGId` int NOT NULL,
  `fromName` varchar(41) DEFAULT NULL,
  `fromStateId` int DEFAULT NULL,
  `fromZip` varchar(10) DEFAULT NULL,
  `mainLocationTagId` bigint DEFAULT NULL,
  `note` longtext,
  `num` varchar(25) NOT NULL,
  `ownerIsFrom` bit(1) NOT NULL,
  `revisionNum` int DEFAULT NULL,
  `shipToAddress` varchar(90) DEFAULT NULL,
  `shipToAttn` varchar(60) DEFAULT NULL,
  `shipToCity` varchar(30) DEFAULT NULL,
  `shipToCountryId` int DEFAULT NULL,
  `shipToLGId` int NOT NULL,
  `shipToName` varchar(41) DEFAULT NULL,
  `shipToStateId` int DEFAULT NULL,
  `shipToZip` varchar(10) DEFAULT NULL,
  `statusId` int NOT NULL,
  `typeId` int NOT NULL,
  `userId` int NOT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `xoitem` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dateLastFulfillment` datetime(6) DEFAULT NULL,
  `dateScheduledFulfillment` datetime(6) NOT NULL,
  `description` varchar(256) DEFAULT NULL,
  `lineItem` int NOT NULL,
  `note` longtext,
  `partId` int DEFAULT NULL,
  `partNum` varchar(70) NOT NULL,
  `qtyFulfilled` decimal(28,9) DEFAULT NULL,
  `qtyPicked` decimal(28,9) DEFAULT NULL,
  `qtyToFulfill` decimal(28,9) DEFAULT NULL,
  `revisionNum` int DEFAULT NULL,
  `statusId` int NOT NULL,
  `totalCost` decimal(28,9) DEFAULT NULL,
  `typeId` int NOT NULL,
  `uomId` int DEFAULT NULL,
  `xoId` int NOT NULL
);

CREATE TABLE `xoitemstatus` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `xoitemtype` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `xostatus` (
  `id` int NOT NULL,
  `name` varchar(20) NOT NULL
);

CREATE TABLE `xotype` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);
