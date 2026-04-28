-- Fishbowl Advanced Schema: Audit Tables — Change history for all main tables (_aud)
-- 107 table(s)
-- Column definitions only. Keys, constraints, and indexes omitted.
-- FK naming convention: fooId -> foo.id  (e.g. customerId -> customer.id)

CREATE TABLE `accountgroup_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `name` varchar(30) DEFAULT NULL
);

CREATE TABLE `address_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `accountId` int DEFAULT NULL,
  `name` varchar(60) DEFAULT NULL,
  `city` varchar(30) DEFAULT NULL,
  `countryId` int DEFAULT NULL,
  `defaultFlag` bit(1) DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `addressName` varchar(90) DEFAULT NULL,
  `residentialFlag` bit(1) DEFAULT NULL,
  `stateId` int DEFAULT NULL,
  `address` varchar(90) DEFAULT NULL,
  `typeID` int DEFAULT NULL,
  `zip` varchar(10) DEFAULT NULL
);

CREATE TABLE `asaccount_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `accountNumber` varchar(36) DEFAULT NULL,
  `accountingHash` varchar(30) DEFAULT NULL,
  `accountingId` varchar(36) DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `name` varchar(155) DEFAULT NULL,
  `typeId` int DEFAULT NULL
);

CREATE TABLE `assocprice_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `assocPriceTypeId` int DEFAULT NULL,
  `price` decimal(28,9) DEFAULT NULL,
  `productId` int DEFAULT NULL
);

CREATE TABLE `bireport_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `biScriptId` int DEFAULT NULL,
  `data` longtext,
  `params` json DEFAULT NULL,
  `name` varchar(64) DEFAULT NULL,
  `description` longtext,
  `widget` tinyint DEFAULT NULL
);

CREATE TABLE `bireportaccess_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `userGroupId` int DEFAULT NULL,
  `biReportId` int DEFAULT NULL,
  `accessLevel` varchar(45) DEFAULT NULL
);

CREATE TABLE `biscript_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `active` bit(1) DEFAULT NULL,
  `data` longtext,
  `description` longtext,
  `name` varchar(64) DEFAULT NULL,
  `note` longtext,
  `typeId` int DEFAULT NULL,
  `fbVersion` int DEFAULT NULL,
  `fbName` varchar(64) DEFAULT NULL,
  `published` tinyint DEFAULT NULL
);

CREATE TABLE `bom_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `autoCreateTypeId` int DEFAULT NULL,
  `configurable` bit(1) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `defaultCalCategoryId` int DEFAULT NULL,
  `description` varchar(252) DEFAULT NULL,
  `estimatedDuration` int DEFAULT NULL,
  `note` longtext,
  `num` varchar(70) DEFAULT NULL,
  `pickFromLocation` bit(1) DEFAULT NULL,
  `qbClassId` int DEFAULT NULL,
  `revision` varchar(31) DEFAULT NULL,
  `statisticsDateRange` varchar(41) DEFAULT NULL,
  `url` varchar(256) DEFAULT NULL,
  `userId` int DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `bominstructionitem_aud` (
  `id` bigint NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `bomId` int DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `details` longtext,
  `name` varchar(256) DEFAULT NULL,
  `sortOrder` int DEFAULT NULL,
  `url` varchar(256) DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `bomitem_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `addToService` bit(1) DEFAULT NULL,
  `bomId` int DEFAULT NULL,
  `bomItemGroupId` int DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `groupDefault` bit(1) DEFAULT NULL,
  `maxQty` decimal(28,9) DEFAULT NULL,
  `minQty` decimal(28,9) DEFAULT NULL,
  `oneTimeItem` bit(1) DEFAULT NULL,
  `partId` int DEFAULT NULL,
  `priceAdjustment` decimal(28,9) DEFAULT NULL,
  `productId` int DEFAULT NULL,
  `quantity` decimal(28,9) DEFAULT NULL,
  `sortIdConfig` int DEFAULT NULL,
  `stage` bit(1) DEFAULT NULL,
  `stageBomId` int DEFAULT NULL,
  `typeId` int DEFAULT NULL,
  `uomId` int DEFAULT NULL,
  `useItemLocation` bit(1) DEFAULT NULL,
  `variableQty` bit(1) DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `bomitemgroup_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `bomId` int DEFAULT NULL,
  `name` varchar(70) DEFAULT NULL,
  `prompt` varchar(256) DEFAULT NULL,
  `sortOrder` int DEFAULT NULL
);

CREATE TABLE `bomitemtolocation_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `bomItemId` int DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `locationId` int DEFAULT NULL
);

CREATE TABLE `bomtolocation_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `bomId` int DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `locationId` int DEFAULT NULL
);

CREATE TABLE `calcategory_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `color` varchar(32) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `lastChangedUserId` int DEFAULT NULL,
  `name` varchar(128) DEFAULT NULL,
  `parentID` int DEFAULT NULL,
  `readOnly` bit(1) DEFAULT NULL
);

CREATE TABLE `calevent_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `allDay` bit(1) DEFAULT NULL,
  `calCategoryId` int DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateEnd` datetime(6) DEFAULT NULL,
  `dateStart` datetime(6) DEFAULT NULL,
  `lastChangedUserId` int DEFAULT NULL,
  `location` varchar(128) DEFAULT NULL,
  `name` varchar(128) DEFAULT NULL,
  `note` longtext
);

CREATE TABLE `carrier_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `name` varchar(60) DEFAULT NULL,
  `readOnly` bit(1) DEFAULT NULL,
  `scac` varchar(4) DEFAULT NULL
);

CREATE TABLE `carrierservice_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `carrierId` int DEFAULT NULL,
  `code` varchar(255) DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `readOnly` bit(1) DEFAULT NULL
);

CREATE TABLE `cartontype_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `defaultFlag` bit(1) DEFAULT NULL,
  `description` varchar(252) DEFAULT NULL,
  `height` decimal(28,9) DEFAULT NULL,
  `len` decimal(28,9) DEFAULT NULL,
  `name` varchar(70) DEFAULT NULL,
  `sizeUOM` varchar(30) DEFAULT NULL,
  `width` decimal(28,9) DEFAULT NULL
);

CREATE TABLE `company_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `EANUCCPrefix` varchar(30) DEFAULT NULL,
  `abn` varchar(25) DEFAULT NULL,
  `accountId` int DEFAULT NULL,
  `dateEntered` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `defaultCarrierId` int DEFAULT NULL,
  `defaultFlag` bit(1) DEFAULT NULL,
  `lastChangedUser` varchar(100) DEFAULT NULL,
  `name` varchar(60) DEFAULT NULL,
  `taxExempt` bit(1) DEFAULT NULL,
  `TAXEXEMPTNUMBER` varchar(30) DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `contact_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `accountId` int DEFAULT NULL,
  `addressId` int DEFAULT NULL,
  `datus` varchar(255) DEFAULT NULL,
  `defaultFlag` bit(1) DEFAULT NULL,
  `contactName` varchar(30) DEFAULT NULL,
  `typeId` int DEFAULT NULL
);

CREATE TABLE `costlayer_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `orgQty` decimal(28,9) DEFAULT NULL,
  `orgTotalCost` decimal(28,9) DEFAULT NULL,
  `partId` int DEFAULT NULL,
  `qty` decimal(28,9) DEFAULT NULL,
  `recordId` bigint DEFAULT NULL,
  `statusId` int DEFAULT NULL,
  `tableId` int DEFAULT NULL,
  `totalCost` decimal(28,9) DEFAULT NULL
);

CREATE TABLE `countryconst_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `abbreviation` varchar(10) DEFAULT NULL,
  `name` varchar(64) DEFAULT NULL
);

CREATE TABLE `currency_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `code` varchar(3) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `excludeFromUpdate` bit(1) DEFAULT NULL,
  `homeCurrency` bit(1) DEFAULT NULL,
  `lastChangedUserId` int DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `rate` decimal(28,9) DEFAULT NULL,
  `symbol` int DEFAULT NULL
);

CREATE TABLE `customer_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `accountId` int DEFAULT NULL,
  `accountingHash` varchar(30) DEFAULT NULL,
  `accountingId` varchar(36) DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `carrierServiceId` int DEFAULT NULL,
  `creditLimit` decimal(28,9) DEFAULT NULL,
  `currencyId` int DEFAULT NULL,
  `currencyRate` decimal(28,9) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `defaultCarrierId` int DEFAULT NULL,
  `defaultPaymentTermsId` int DEFAULT NULL,
  `defaultPriorityId` int DEFAULT NULL,
  `defaultSalesmanId` int DEFAULT NULL,
  `defaultShipTermsId` int DEFAULT NULL,
  `jobDepth` int DEFAULT NULL,
  `lastChangedUser` varchar(100) DEFAULT NULL,
  `name` varchar(41) DEFAULT NULL,
  `note` varchar(1024) DEFAULT NULL,
  `number` varchar(30) DEFAULT NULL,
  `parentId` int DEFAULT NULL,
  `qbClassId` int DEFAULT NULL,
  `statusId` int DEFAULT NULL,
  `sysUserId` int DEFAULT NULL,
  `taxExempt` bit(1) DEFAULT NULL,
  `taxExemptNumber` varchar(30) DEFAULT NULL,
  `taxRateId` int DEFAULT NULL,
  `toBeEmailed` bit(1) DEFAULT NULL,
  `toBePrinted` bit(1) DEFAULT NULL,
  `url` varchar(256) DEFAULT NULL,
  `issuableStatusId` int DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `customerparts_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `customerId` int DEFAULT NULL,
  `customerPartNumber` varchar(70) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastPurchased` datetime(6) DEFAULT NULL,
  `lastChangedUserId` int DEFAULT NULL,
  `lastPrice` decimal(28,9) DEFAULT NULL,
  `productId` int DEFAULT NULL
);

CREATE TABLE `customfield_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `accessRight` bit(1) DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `customFieldTypeId` int DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `listId` int DEFAULT NULL,
  `name` varchar(41) DEFAULT NULL,
  `required` bit(1) DEFAULT NULL,
  `sortOrder` int DEFAULT NULL,
  `tableId` int DEFAULT NULL
);

CREATE TABLE `customlist_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `name` varchar(41) DEFAULT NULL
);

CREATE TABLE `customlistitem_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `listId` int DEFAULT NULL,
  `name` varchar(41) DEFAULT NULL
);

CREATE TABLE `dataexport_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `dataQuery` longtext,
  `dateCreated` datetime(6) DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `lastChangedUserId` int DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL
);

CREATE TABLE `defaultlocation_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `locationId` int DEFAULT NULL,
  `partId` int DEFAULT NULL
);

CREATE TABLE `fbschedule_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `actionSubType` varchar(100) DEFAULT NULL,
  `actionTypeId` int DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `cronString` varchar(90) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateNextScheduled` datetime(6) DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `directory` varchar(255) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `emailReport` varchar(255) DEFAULT NULL,
  `fileMask` varchar(30) DEFAULT NULL,
  `fileName` varchar(30) DEFAULT NULL,
  `javaClass` varchar(255) DEFAULT NULL,
  `lastChangedUserId` int DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `parameters` varchar(255) DEFAULT NULL,
  `reportId` int DEFAULT NULL,
  `pluginManaged` bit(1) NOT NULL DEFAULT 0,
  `deleteBackupOlderThan` int NOT NULL DEFAULT 0
);

CREATE TABLE `fobpoint_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `name` varchar(15) DEFAULT NULL
);

CREATE TABLE `integratedapp_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `appKey` varchar(15) DEFAULT NULL,
  `authorized` bit(1) DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `name` varchar(41) DEFAULT NULL,
  `statusId` int DEFAULT NULL
);

CREATE TABLE `itemadjust_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `amount` decimal(28,9) DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `expenseAsAccountId` int DEFAULT NULL,
  `incomeAsAccountId` int DEFAULT NULL,
  `name` varchar(31) DEFAULT NULL,
  `percentage` decimal(28,9) DEFAULT NULL,
  `taxRateId` int DEFAULT NULL,
  `taxableFlag` bit(1) DEFAULT NULL,
  `typeId` int DEFAULT NULL
);

CREATE TABLE `kititem_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `defaultQty` decimal(28,9) DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `discountId` int DEFAULT NULL,
  `kitItemTypeId` int DEFAULT NULL,
  `kitProductId` int DEFAULT NULL,
  `kitTypeId` int DEFAULT NULL,
  `maxQty` decimal(28,9) DEFAULT NULL,
  `minQty` decimal(28,9) DEFAULT NULL,
  `note` longtext,
  `productId` int DEFAULT NULL,
  `qtyPriceAdjustment` decimal(28,9) DEFAULT NULL,
  `soItemTypeId` int DEFAULT NULL,
  `sortOrder` int DEFAULT NULL,
  `taxRateId` int DEFAULT NULL,
  `uomId` int DEFAULT NULL
);

CREATE TABLE `kitoption_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `defaultFlag` bit(1) DEFAULT NULL,
  `kitItemId` int DEFAULT NULL,
  `priceAdjustment` decimal(28,9) DEFAULT NULL,
  `productId` int DEFAULT NULL
);

CREATE TABLE `location_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `countedAsAvailable` bit(1) DEFAULT NULL,
  `defaultCustomerId` int DEFAULT NULL,
  `defaultFlag` bit(1) DEFAULT NULL,
  `defaultVendorId` int DEFAULT NULL,
  `description` varchar(252) DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `name` varchar(30) DEFAULT NULL,
  `parentId` int DEFAULT NULL,
  `pickable` bit(1) DEFAULT NULL,
  `receivable` bit(1) DEFAULT NULL,
  `sortOrder` int DEFAULT NULL,
  `typeId` int DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `locationgroup_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `name` varchar(30) DEFAULT NULL,
  `qbClassId` int DEFAULT NULL
);

CREATE TABLE `memo_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `memo` longtext,
  `recordId` int DEFAULT NULL,
  `tableId` int DEFAULT NULL,
  `userName` varchar(100) DEFAULT NULL
);

CREATE TABLE `mo_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `dateCompleted` datetime(6) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateIssued` datetime(6) DEFAULT NULL,
  `dateScheduled` datetime(6) DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `note` longtext,
  `num` varchar(25) DEFAULT NULL,
  `qbClassId` int DEFAULT NULL,
  `revision` int DEFAULT NULL,
  `soId` int DEFAULT NULL,
  `statusId` int DEFAULT NULL,
  `url` varchar(256) DEFAULT NULL,
  `userId` int DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `moitem_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `addToService` bit(1) DEFAULT NULL,
  `bomId` int DEFAULT NULL,
  `bomItemId` int DEFAULT NULL,
  `dateScheduled` datetime(6) DEFAULT NULL,
  `dateScheduledToStart` datetime(6) DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `instructionNote` longtext,
  `moId` int DEFAULT NULL,
  `oneTimeItem` bit(1) DEFAULT NULL,
  `parentId` int DEFAULT NULL,
  `partId` int DEFAULT NULL,
  `priceAdjustment` decimal(28,9) DEFAULT NULL,
  `priorityId` int DEFAULT NULL,
  `qbClassId` int DEFAULT NULL,
  `qtyFulfilled` decimal(28,9) DEFAULT NULL,
  `qtyToFulfill` decimal(28,9) DEFAULT NULL,
  `soItemId` int DEFAULT NULL,
  `sortIdInstruct` int DEFAULT NULL,
  `stage` bit(1) DEFAULT NULL,
  `stageLevel` int DEFAULT NULL,
  `statusId` int DEFAULT NULL,
  `totalCost` decimal(28,9) DEFAULT NULL,
  `typeId` int DEFAULT NULL,
  `uomId` int DEFAULT NULL,
  `calCategoryId` int DEFAULT NULL
);

CREATE TABLE `objecttoobject_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `note` varchar(30) DEFAULT NULL,
  `recordId1` int DEFAULT NULL,
  `recordId2` int DEFAULT NULL,
  `tableId1` int DEFAULT NULL,
  `tableId2` int DEFAULT NULL,
  `typeId` int DEFAULT NULL
);

CREATE TABLE `part_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `abcCode` varchar(1) DEFAULT NULL,
  `accountingHash` varchar(30) DEFAULT NULL,
  `accountingId` varchar(36) DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `adjustmentAccountId` int DEFAULT NULL,
  `alertNote` varchar(256) DEFAULT NULL,
  `alwaysManufacture` bit(1) DEFAULT NULL,
  `cogsAccountId` int DEFAULT NULL,
  `configurable` bit(1) DEFAULT NULL,
  `consumptionRate` decimal(28,9) DEFAULT NULL,
  `controlledFlag` bit(1) DEFAULT NULL,
  `cycleCountTol` decimal(28,9) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
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
  `leadTimeToFulfill` int DEFAULT NULL,
  `len` decimal(28,9) DEFAULT NULL,
  `num` varchar(70) DEFAULT NULL,
  `partClassId` int DEFAULT NULL,
  `pickInUomOfPart` bit(1) DEFAULT NULL,
  `receivingTol` decimal(28,9) DEFAULT NULL,
  `revision` varchar(15) DEFAULT NULL,
  `scrapAccountId` int DEFAULT NULL,
  `serializedFlag` bit(1) DEFAULT NULL,
  `sizeUomId` int DEFAULT NULL,
  `stdCost` decimal(28,9) DEFAULT NULL,
  `taxId` int DEFAULT NULL,
  `trackingFlag` bit(1) DEFAULT NULL,
  `typeId` int DEFAULT NULL,
  `uomId` int DEFAULT NULL,
  `upc` varchar(31) DEFAULT NULL,
  `url` varchar(256) DEFAULT NULL,
  `varianceAccountId` int DEFAULT NULL,
  `weight` decimal(28,9) DEFAULT NULL,
  `weightUomId` int DEFAULT NULL,
  `width` decimal(28,9) DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `partcost_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `avgCost` decimal(28,9) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `partId` int DEFAULT NULL,
  `qty` decimal(28,9) DEFAULT NULL,
  `totalCost` decimal(28,9) DEFAULT NULL
);

CREATE TABLE `partreorder_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `orderUpToLevel` decimal(28,9) DEFAULT NULL,
  `partId` int DEFAULT NULL,
  `reorderPoint` decimal(28,9) DEFAULT NULL
);

CREATE TABLE `parttotracking_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `nextValue` varchar(41) DEFAULT NULL,
  `partId` int DEFAULT NULL,
  `partTrackingId` int DEFAULT NULL,
  `primaryFlag` bit(1) DEFAULT NULL
);

CREATE TABLE `parttracking_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `abbr` varchar(10) DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `name` varchar(41) DEFAULT NULL,
  `sortOrder` int DEFAULT NULL,
  `typeId` int DEFAULT NULL,
  `gs1Code` int DEFAULT NULL
);

CREATE TABLE `paymentmethod_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `active` bit(1) DEFAULT NULL,
  `editable` bit(1) DEFAULT NULL,
  `name` varchar(31) DEFAULT NULL,
  `typeId` int DEFAULT NULL,
  `depositAccountId` int DEFAULT NULL
);

CREATE TABLE `paymentterms_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `accountingHash` varchar(30) DEFAULT NULL,
  `accountingId` varchar(36) DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `defaultTerm` bit(1) DEFAULT NULL,
  `discount` double DEFAULT NULL,
  `discountDays` int DEFAULT NULL,
  `name` varchar(31) DEFAULT NULL,
  `netDays` int DEFAULT NULL,
  `nextMonth` int DEFAULT NULL,
  `readOnly` bit(1) DEFAULT NULL,
  `typeId` int DEFAULT NULL
);

CREATE TABLE `pick_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateFinished` datetime(6) DEFAULT NULL,
  `dateScheduled` datetime(6) DEFAULT NULL,
  `dateStarted` datetime(6) DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `num` varchar(35) DEFAULT NULL,
  `priority` int DEFAULT NULL,
  `statusId` int DEFAULT NULL,
  `toBePrinted` bit(1) DEFAULT NULL,
  `typeId` int DEFAULT NULL,
  `userId` int DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `pickitem_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `destTagId` bigint DEFAULT NULL,
  `orderId` int DEFAULT NULL,
  `orderTypeId` int DEFAULT NULL,
  `partId` int DEFAULT NULL,
  `pickId` int DEFAULT NULL,
  `poItemId` int DEFAULT NULL,
  `qty` decimal(28,9) DEFAULT NULL,
  `shipId` int DEFAULT NULL,
  `slotNum` int DEFAULT NULL,
  `soItemId` int DEFAULT NULL,
  `srcLocationId` int DEFAULT NULL,
  `srcTagId` bigint DEFAULT NULL,
  `statusId` int DEFAULT NULL,
  `tagId` bigint DEFAULT NULL,
  `typeId` int DEFAULT NULL,
  `uomId` int DEFAULT NULL,
  `woItemId` int DEFAULT NULL,
  `xoItemId` int DEFAULT NULL
);

CREATE TABLE `plugininfo_aud` (
  `id` bigint NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `channelId` varchar(255) DEFAULT NULL,
  `groupId` int DEFAULT NULL,
  `info` json DEFAULT NULL,
  `plugin` varchar(255) DEFAULT NULL,
  `recordId` int DEFAULT NULL,
  `tableName` varchar(255) DEFAULT NULL
);

CREATE TABLE `pluginproperties_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `dataKey` varchar(255) DEFAULT NULL,
  `info` varchar(255) DEFAULT NULL,
  `plugin` varchar(255) DEFAULT NULL
);

CREATE TABLE `po_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `buyer` varchar(100) DEFAULT NULL,
  `buyerId` int DEFAULT NULL,
  `carrierId` int DEFAULT NULL,
  `carrierServiceId` int DEFAULT NULL,
  `currencyId` int DEFAULT NULL,
  `currencyRate` decimal(28,9) DEFAULT NULL,
  `customerSO` varchar(25) DEFAULT NULL,
  `dateCompleted` datetime(6) DEFAULT NULL,
  `dateConfirmed` datetime(6) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateFirstShip` datetime(6) DEFAULT NULL,
  `dateIssued` datetime(6) DEFAULT NULL,
  `dateRevision` datetime(6) DEFAULT NULL,
  `deliverTo` varchar(30) DEFAULT NULL,
  `email` varchar(256) DEFAULT NULL,
  `fobPointId` int DEFAULT NULL,
  `issuedByUserId` int DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `note` longtext,
  `num` varchar(25) DEFAULT NULL,
  `paymentTermsId` int DEFAULT NULL,
  `phone` varchar(256) DEFAULT NULL,
  `qbClassId` int DEFAULT NULL,
  `remitAddress` varchar(90) DEFAULT NULL,
  `remitCity` varchar(30) DEFAULT NULL,
  `remitCountryId` int DEFAULT NULL,
  `remitStateId` int DEFAULT NULL,
  `remitToName` varchar(60) DEFAULT NULL,
  `remitZip` varchar(10) DEFAULT NULL,
  `revisionNum` int DEFAULT NULL,
  `shipTermsId` int DEFAULT NULL,
  `shipToAddress` varchar(90) DEFAULT NULL,
  `shipToCity` varchar(30) DEFAULT NULL,
  `shipToCountryId` int DEFAULT NULL,
  `shipToName` varchar(60) DEFAULT NULL,
  `shipToStateId` int DEFAULT NULL,
  `shipToZip` varchar(10) DEFAULT NULL,
  `statusId` int DEFAULT NULL,
  `taxRateId` int DEFAULT NULL,
  `taxRateName` varchar(31) DEFAULT NULL,
  `totalIncludesTax` bit(1) DEFAULT NULL,
  `totalTax` decimal(28,9) DEFAULT NULL,
  `typeId` int DEFAULT NULL,
  `url` varchar(256) DEFAULT NULL,
  `username` varchar(100) DEFAULT NULL,
  `vendorContact` varchar(30) DEFAULT NULL,
  `vendorId` int DEFAULT NULL,
  `vendorSO` varchar(25) DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `poitem_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `customerId` int DEFAULT NULL,
  `dateLastFulfillment` datetime(6) DEFAULT NULL,
  `dateScheduledFulfillment` datetime(6) DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `mcTotalCost` decimal(28,9) DEFAULT NULL,
  `mcUnitCost` decimal(28,9) DEFAULT NULL,
  `note` longtext,
  `partId` int DEFAULT NULL,
  `outsourcedPartId` int DEFAULT NULL,
  `partNum` varchar(70) DEFAULT NULL,
  `poId` int DEFAULT NULL,
  `poLineItem` int DEFAULT NULL,
  `qbClassId` int DEFAULT NULL,
  `qtyFulfilled` decimal(28,9) DEFAULT NULL,
  `qtyPicked` decimal(28,9) DEFAULT NULL,
  `qtyToFulfill` decimal(28,9) DEFAULT NULL,
  `repairFlag` bit(1) DEFAULT NULL,
  `revLevel` varchar(15) DEFAULT NULL,
  `statusId` int DEFAULT NULL,
  `taxId` int DEFAULT NULL,
  `taxRate` double DEFAULT NULL,
  `tbdCostFlag` bit(1) DEFAULT NULL,
  `totalCost` decimal(28,9) DEFAULT NULL,
  `typeId` int DEFAULT NULL,
  `unitCost` decimal(28,9) DEFAULT NULL,
  `uomId` int DEFAULT NULL,
  `vendorPartNum` varchar(70) DEFAULT NULL,
  `outsourcedPartNumber` varchar(70) NOT NULL,
  `outsourcedPartDescription` varchar(256) NOT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `postransaction_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `amount` decimal(28,9) DEFAULT NULL,
  `authCode` varchar(100) DEFAULT NULL,
  `changeGiven` decimal(28,9) DEFAULT NULL,
  `confirmation` varchar(30) DEFAULT NULL,
  `currencyRate` decimal(28,9) DEFAULT NULL,
  `dateTime` datetime(6) DEFAULT NULL,
  `depositToAccountId` int DEFAULT NULL,
  `expDate` datetime(6) DEFAULT NULL,
  `merchantActNum` varchar(20) DEFAULT NULL,
  `paymentMethodId` int DEFAULT NULL,
  `soId` int DEFAULT NULL,
  `transactionId` varchar(100) DEFAULT NULL,
  `userId` int DEFAULT NULL,
  `info` varchar(100) DEFAULT NULL
);

CREATE TABLE `pricingrule_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `customerInclId` int DEFAULT NULL,
  `customerInclTypeId` int DEFAULT NULL,
  `dateApplies` bit(1) DEFAULT NULL,
  `dateBegin` datetime(6) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateEnd` datetime(6) DEFAULT NULL,
  `description` longtext,
  `isActive` bit(1) DEFAULT NULL,
  `isAutoApply` bit(1) DEFAULT NULL,
  `isTier2` bit(1) DEFAULT NULL,
  `name` varchar(41) DEFAULT NULL,
  `paAmount` decimal(28,9) DEFAULT NULL,
  `paApplies` bit(1) DEFAULT NULL,
  `paBaseAmountTypeId` int DEFAULT NULL,
  `paPercent` decimal(28,9) DEFAULT NULL,
  `paTypeId` int DEFAULT NULL,
  `productInclId` int DEFAULT NULL,
  `productInclTypeId` int DEFAULT NULL,
  `qtyApplies` bit(1) DEFAULT NULL,
  `qtyMax` decimal(28,9) DEFAULT NULL,
  `qtyMin` decimal(28,9) DEFAULT NULL,
  `rndApplies` bit(1) DEFAULT NULL,
  `rndIsMinus` bit(1) DEFAULT NULL,
  `rndPMAmount` decimal(28,9) DEFAULT NULL,
  `rndToAmount` decimal(28,9) DEFAULT NULL,
  `rndTypeId` int DEFAULT NULL,
  `spcApplies` bit(1) DEFAULT NULL,
  `spcBuyX` int DEFAULT NULL,
  `spcGetYFree` int DEFAULT NULL,
  `userId` int DEFAULT NULL
);

CREATE TABLE `product_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `accountingHash` varchar(30) DEFAULT NULL,
  `accountingId` varchar(36) DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `alertNote` varchar(256) DEFAULT NULL,
  `cartonCount` decimal(28,9) DEFAULT NULL,
  `defaultCartonTypeId` int DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `defaultSoItemType` int DEFAULT NULL,
  `description` varchar(252) DEFAULT NULL,
  `details` longtext,
  `displayTypeId` int DEFAULT NULL,
  `height` decimal(28,9) DEFAULT NULL,
  `incomeAccountId` int DEFAULT NULL,
  `kitFlag` bit(1) DEFAULT NULL,
  `kitGroupedFlag` bit(1) DEFAULT NULL,
  `len` decimal(28,9) DEFAULT NULL,
  `num` varchar(70) DEFAULT NULL,
  `partId` int DEFAULT NULL,
  `price` decimal(28,9) DEFAULT NULL,
  `qbClassId` int DEFAULT NULL,
  `sellableInOtherUoms` bit(1) DEFAULT NULL,
  `showSoComboFlag` bit(1) DEFAULT NULL,
  `sizeUomId` int DEFAULT NULL,
  `sku` varchar(31) DEFAULT NULL,
  `taxId` int DEFAULT NULL,
  `taxableFlag` bit(1) DEFAULT NULL,
  `uomId` int DEFAULT NULL,
  `upc` varchar(31) DEFAULT NULL,
  `url` varchar(256) DEFAULT NULL,
  `usePriceFlag` bit(1) DEFAULT NULL,
  `weight` decimal(28,9) DEFAULT NULL,
  `weightUomId` int DEFAULT NULL,
  `width` decimal(28,9) DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `producttotree_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `productId` int DEFAULT NULL,
  `productTreeId` int DEFAULT NULL
);

CREATE TABLE `producttree_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `name` varchar(30) DEFAULT NULL,
  `parentId` int DEFAULT NULL
);

CREATE TABLE `qbclass_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `accountingHash` varchar(30) DEFAULT NULL,
  `accountingId` varchar(36) DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `name` varchar(31) DEFAULT NULL,
  `parentId` int DEFAULT NULL
);

CREATE TABLE `quicklist_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `customerId` int DEFAULT NULL,
  `name` varchar(30) DEFAULT NULL
);

CREATE TABLE `quicklistitem_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `productId` int DEFAULT NULL,
  `qListId` int DEFAULT NULL,
  `quantity` decimal(28,9) DEFAULT NULL
);

CREATE TABLE `receipt_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `orderTypeId` int DEFAULT NULL,
  `poId` int DEFAULT NULL,
  `soId` int DEFAULT NULL,
  `statusId` int DEFAULT NULL,
  `typeId` int DEFAULT NULL,
  `userId` int DEFAULT NULL,
  `xoId` int DEFAULT NULL
);

CREATE TABLE `receiptitem_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `billVendorFlag` bit(1) DEFAULT NULL,
  `billedTotalCost` decimal(28,9) DEFAULT NULL,
  `mcBilledTotalCost` decimal(28,9) DEFAULT NULL,
  `billedUnitCost` decimal(28,9) DEFAULT NULL,
  `mcBilledUnitCost` decimal(28,9) DEFAULT NULL,
  `carrierId` int DEFAULT NULL,
  `customerId` int DEFAULT NULL,
  `dateBilled` datetime(6) DEFAULT NULL,
  `dateReceived` datetime(6) DEFAULT NULL,
  `dateReconciled` datetime(6) DEFAULT NULL,
  `deliverTo` varchar(30) DEFAULT NULL,
  `landedTotalCost` decimal(28,9) DEFAULT NULL,
  `mcLandedTotalCost` decimal(28,9) DEFAULT NULL,
  `locationId` int DEFAULT NULL,
  `orderTypeId` int DEFAULT NULL,
  `packageCount` int DEFAULT NULL,
  `partId` int DEFAULT NULL,
  `partTypeId` int DEFAULT NULL,
  `poItemId` int DEFAULT NULL,
  `qty` decimal(28,9) DEFAULT NULL,
  `reason` varchar(90) DEFAULT NULL,
  `receiptId` int DEFAULT NULL,
  `refNo` varchar(20) DEFAULT NULL,
  `responsibilityId` int DEFAULT NULL,
  `shipItemId` int DEFAULT NULL,
  `soItemId` int DEFAULT NULL,
  `statusId` int DEFAULT NULL,
  `tagId` bigint DEFAULT NULL,
  `taxId` int DEFAULT NULL,
  `taxRate` double DEFAULT NULL,
  `trackingNum` varchar(30) DEFAULT NULL,
  `typeId` int DEFAULT NULL,
  `uomId` int DEFAULT NULL,
  `xoItemId` int DEFAULT NULL,
  `outsourcedCost` decimal(28,9) DEFAULT NULL,
  `carrierServiceId` int DEFAULT NULL
);

CREATE TABLE `register_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `name` varchar(15) DEFAULT NULL
);

CREATE TABLE `report_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `description` longtext,
  `lastChangedUserId` int DEFAULT NULL,
  `name` varchar(64) DEFAULT NULL,
  `path` varchar(256) DEFAULT NULL,
  `readOnly` bit(1) DEFAULT NULL,
  `reportTreeId` int DEFAULT NULL,
  `userId` int DEFAULT NULL
);

CREATE TABLE `reportparameter_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `name` varchar(64) DEFAULT NULL,
  `paramValue` varchar(255) DEFAULT NULL
);

CREATE TABLE `reporttomodule_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `moduleId` int DEFAULT NULL,
  `reportId` int DEFAULT NULL
);

CREATE TABLE `reporttree_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `name` varchar(64) DEFAULT NULL,
  `parentId` int DEFAULT NULL,
  `readOnly` bit(1) DEFAULT NULL,
  `userId` int DEFAULT NULL
);

CREATE TABLE `rma_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `customerId` int DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateExpires` datetime(6) DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `num` varchar(25) DEFAULT NULL,
  `statusId` int DEFAULT NULL,
  `userId` int DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `rmaitem_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `crossShipFlag` bit(1) DEFAULT NULL,
  `dateResolved` datetime(6) DEFAULT NULL,
  `issueId` int DEFAULT NULL,
  `lineNum` int DEFAULT NULL,
  `note` longtext,
  `productId` int DEFAULT NULL,
  `productSubId` int DEFAULT NULL,
  `qty` decimal(28,9) DEFAULT NULL,
  `resolutionId` int DEFAULT NULL,
  `returnFlag` bit(1) DEFAULT NULL,
  `rmaId` int DEFAULT NULL,
  `shipFlag` bit(1) DEFAULT NULL,
  `typeId` int DEFAULT NULL,
  `uomId` int DEFAULT NULL,
  `vendorId` int DEFAULT NULL,
  `vendorRMA` varchar(25) DEFAULT NULL
);

CREATE TABLE `serial_aud` (
  `id` bigint NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `committedFlag` bit(1) DEFAULT NULL,
  `tagId` bigint DEFAULT NULL
);

CREATE TABLE `serialnum_aud` (
  `id` bigint NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `partTrackingId` int DEFAULT NULL,
  `serialId` bigint DEFAULT NULL,
  `serialNum` varchar(256) DEFAULT NULL
);

CREATE TABLE `ship_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `FOBPointId` int DEFAULT NULL,
  `billOfLading` varchar(20) DEFAULT NULL,
  `carrierId` int DEFAULT NULL,
  `carrierServiceId` int DEFAULT NULL,
  `cartonCount` int DEFAULT NULL,
  `contact` varchar(250) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateShipped` datetime(6) DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `note` longtext,
  `num` varchar(35) DEFAULT NULL,
  `orderTypeId` int DEFAULT NULL,
  `ownerIsFrom` bit(1) DEFAULT NULL,
  `poId` int DEFAULT NULL,
  `shipToId` int DEFAULT NULL,
  `shipmentIdentificationNumber` varchar(32) DEFAULT NULL,
  `shippedBy` int DEFAULT NULL,
  `soId` int DEFAULT NULL,
  `statusId` int DEFAULT NULL,
  `xoId` int DEFAULT NULL,
  `shipToAddress` varchar(90) DEFAULT NULL,
  `shipToCity` varchar(30) DEFAULT NULL,
  `shipToName` varchar(60) DEFAULT NULL,
  `shipToZip` varchar(10) DEFAULT NULL,
  `shipToCountryId` int DEFAULT NULL,
  `shipToStateId` int DEFAULT NULL,
  `shipToResidential` bit(1) DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `shipcarton_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `additionalHandling` bit(1) DEFAULT NULL,
  `carrierId` int DEFAULT NULL,
  `cartonNum` int DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `freightAmount` decimal(28,9) DEFAULT NULL,
  `freightWeight` decimal(28,9) DEFAULT NULL,
  `height` decimal(28,9) DEFAULT NULL,
  `insuredValue` decimal(28,9) DEFAULT NULL,
  `len` decimal(28,9) DEFAULT NULL,
  `orderId` int DEFAULT NULL,
  `orderTypeId` int DEFAULT NULL,
  `shipId` int DEFAULT NULL,
  `shipperRelease` bit(1) DEFAULT NULL,
  `sizeUOM` varchar(30) DEFAULT NULL,
  `sscc` varchar(20) DEFAULT NULL,
  `trackingNum` varchar(255) DEFAULT NULL,
  `weightUOM` varchar(32) DEFAULT NULL,
  `width` decimal(28,9) DEFAULT NULL
);

CREATE TABLE `shipitem_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `itemId` int DEFAULT NULL,
  `orderId` int DEFAULT NULL,
  `orderTypeId` int DEFAULT NULL,
  `poItemId` int DEFAULT NULL,
  `qtyShipped` decimal(28,9) DEFAULT NULL,
  `shipCartonId` int DEFAULT NULL,
  `shipId` int DEFAULT NULL,
  `soItemId` int DEFAULT NULL,
  `tagId` bigint DEFAULT NULL,
  `totalCost` decimal(28,9) DEFAULT NULL,
  `uomId` int DEFAULT NULL,
  `xoItemId` int DEFAULT NULL
);

CREATE TABLE `shipterms_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `name` varchar(30) DEFAULT NULL,
  `readOnly` bit(1) DEFAULT NULL
);

CREATE TABLE `so_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `billToAddress` varchar(90) DEFAULT NULL,
  `billToCity` varchar(30) DEFAULT NULL,
  `billToCountryId` int DEFAULT NULL,
  `billToName` varchar(60) DEFAULT NULL,
  `billToStateId` int DEFAULT NULL,
  `billToZip` varchar(10) DEFAULT NULL,
  `calCategoryId` int DEFAULT NULL,
  `carrierId` int DEFAULT NULL,
  `carrierServiceId` int DEFAULT NULL,
  `cost` decimal(28,9) DEFAULT NULL,
  `createdByUserId` int DEFAULT NULL,
  `currencyId` int DEFAULT NULL,
  `currencyRate` decimal(28,9) DEFAULT NULL,
  `customerContact` varchar(30) DEFAULT NULL,
  `customerId` int DEFAULT NULL,
  `customerPO` varchar(25) DEFAULT NULL,
  `dateCalStart` datetime(6) DEFAULT NULL,
  `dateCalEnd` datetime(6) DEFAULT NULL,
  `dateCompleted` datetime(6) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateExpired` datetime(6) DEFAULT NULL,
  `dateFirstShip` datetime(6) DEFAULT NULL,
  `dateIssued` datetime(6) DEFAULT NULL,
  `dateRevision` datetime(6) DEFAULT NULL,
  `email` varchar(256) DEFAULT NULL,
  `estimatedTax` decimal(28,9) DEFAULT NULL,
  `fobPointId` int DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `mcTotalTax` decimal(28,9) DEFAULT NULL,
  `note` longtext,
  `num` varchar(25) DEFAULT NULL,
  `paymentLink` varchar(256) DEFAULT NULL,
  `paymentTermsId` int DEFAULT NULL,
  `phone` varchar(256) DEFAULT NULL,
  `priorityId` int DEFAULT NULL,
  `qbClassId` int DEFAULT NULL,
  `registerId` int DEFAULT NULL,
  `shipToResidential` bit(1) DEFAULT NULL,
  `revisionNum` int DEFAULT NULL,
  `salesman` varchar(100) DEFAULT NULL,
  `salesmanId` int DEFAULT NULL,
  `salesmanInitials` varchar(5) DEFAULT NULL,
  `shipTermsId` int DEFAULT NULL,
  `shipToAddress` varchar(90) DEFAULT NULL,
  `shipToCity` varchar(30) DEFAULT NULL,
  `shipToCountryId` int DEFAULT NULL,
  `shipToName` varchar(60) DEFAULT NULL,
  `shipToStateId` int DEFAULT NULL,
  `shipToZip` varchar(10) DEFAULT NULL,
  `statusId` int DEFAULT NULL,
  `taxRate` double DEFAULT NULL,
  `taxRateId` int DEFAULT NULL,
  `taxRateName` varchar(31) DEFAULT NULL,
  `toBeEmailed` bit(1) DEFAULT NULL,
  `toBePrinted` bit(1) DEFAULT NULL,
  `totalIncludesTax` bit(1) DEFAULT NULL,
  `totalTax` decimal(28,9) DEFAULT NULL,
  `subTotal` decimal(28,9) DEFAULT NULL,
  `totalPrice` decimal(28,9) DEFAULT NULL,
  `typeId` int DEFAULT NULL,
  `url` varchar(256) DEFAULT NULL,
  `username` varchar(100) DEFAULT NULL,
  `vendorPO` varchar(25) DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `soitem_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `adjustAmount` decimal(28,9) DEFAULT NULL,
  `adjustPercentage` decimal(28,9) DEFAULT NULL,
  `customerPartNum` varchar(70) DEFAULT NULL,
  `dateLastFulfillment` datetime(6) DEFAULT NULL,
  `dateScheduledFulfillment` datetime(6) DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `exchangeSOLineItem` int DEFAULT NULL,
  `itemAdjustId` int DEFAULT NULL,
  `markupCost` decimal(28,9) DEFAULT NULL,
  `mcTotalPrice` decimal(28,9) DEFAULT NULL,
  `note` longtext,
  `priceLocked` bit(1) DEFAULT NULL,
  `productId` int DEFAULT NULL,
  `productNum` varchar(70) DEFAULT NULL,
  `qbClassId` int DEFAULT NULL,
  `qtyFulfilled` decimal(28,9) DEFAULT NULL,
  `qtyOrdered` decimal(28,9) DEFAULT NULL,
  `qtyPicked` decimal(28,9) DEFAULT NULL,
  `qtyToFulfill` decimal(28,9) DEFAULT NULL,
  `revLevel` varchar(15) DEFAULT NULL,
  `showItemFlag` bit(1) DEFAULT NULL,
  `soId` int DEFAULT NULL,
  `soLineItem` int DEFAULT NULL,
  `statusId` int DEFAULT NULL,
  `taxId` int DEFAULT NULL,
  `taxRate` double DEFAULT NULL,
  `taxableFlag` bit(1) DEFAULT NULL,
  `totalCost` decimal(28,9) DEFAULT NULL,
  `totalPrice` decimal(28,9) DEFAULT NULL,
  `typeId` int DEFAULT NULL,
  `unitPrice` decimal(28,9) DEFAULT NULL,
  `uomId` int DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `stateconst_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `code` varchar(21) DEFAULT NULL,
  `countryConstID` int DEFAULT NULL,
  `name` varchar(60) DEFAULT NULL
);

CREATE TABLE `sysproperties_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `owner` varchar(30) DEFAULT NULL,
  `readAllowed` bit(1) DEFAULT NULL,
  `sysKey` varchar(30) DEFAULT NULL,
  `sysValue` varchar(3072) DEFAULT NULL,
  `writeAllowed` bit(1) DEFAULT NULL
);

CREATE TABLE `sysuser_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `firstName` varchar(15) DEFAULT NULL,
  `initials` varchar(5) DEFAULT NULL,
  `lastName` varchar(15) DEFAULT NULL,
  `phone` varchar(255) DEFAULT NULL,
  `userName` varchar(100) DEFAULT NULL,
  `userPwd` varchar(255) DEFAULT NULL,
  `passwordLastModified` datetime(6) DEFAULT NULL,
  `passwordExpiration` datetime(6) DEFAULT NULL,
  `mfaSecret` varchar(64) DEFAULT NULL,
  `mfaBypassCounter` int DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `taxrate_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `accountingHash` varchar(30) DEFAULT NULL,
  `accountingId` varchar(36) DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `code` varchar(5) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `defaultFlag` bit(1) DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `name` varchar(31) DEFAULT NULL,
  `orderTypeId` int DEFAULT NULL,
  `rate` double DEFAULT NULL,
  `taxAccountId` int DEFAULT NULL,
  `typeCode` varchar(50) DEFAULT NULL,
  `typeId` int DEFAULT NULL,
  `unitCost` decimal(28,9) DEFAULT NULL,
  `vendorId` int DEFAULT NULL
);

CREATE TABLE `trackingdate_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `info` datetime(6) DEFAULT NULL,
  `partTrackingId` int DEFAULT NULL,
  `tagId` bigint DEFAULT NULL
);

CREATE TABLE `trackingdecimal_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `info` double DEFAULT NULL,
  `partTrackingId` int DEFAULT NULL,
  `tagId` bigint DEFAULT NULL
);

CREATE TABLE `trackinginfo_aud` (
  `id` bigint NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `info` varchar(256) DEFAULT NULL,
  `infoDate` datetime(6) DEFAULT NULL,
  `infoDouble` double DEFAULT NULL,
  `infoInteger` int DEFAULT NULL,
  `partTrackingId` int DEFAULT NULL,
  `qty` decimal(28,9) DEFAULT NULL,
  `recordId` int DEFAULT NULL,
  `tableId` int DEFAULT NULL
);

CREATE TABLE `trackinginfosn_aud` (
  `id` bigint NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `partTrackingId` int DEFAULT NULL,
  `serialNum` varchar(256) DEFAULT NULL,
  `trackingInfoId` bigint DEFAULT NULL
);

CREATE TABLE `trackinginteger_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `info` int DEFAULT NULL,
  `partTrackingId` int DEFAULT NULL,
  `tagId` bigint DEFAULT NULL
);

CREATE TABLE `trackingtext_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `info` varchar(256) DEFAULT NULL,
  `partTrackingId` int DEFAULT NULL,
  `tagId` bigint DEFAULT NULL
);

CREATE TABLE `uom_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `code` varchar(10) DEFAULT NULL,
  `defaultRecord` bit(1) DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `integral` bit(1) DEFAULT NULL,
  `name` varchar(30) DEFAULT NULL,
  `readOnly` bit(1) DEFAULT NULL,
  `uomType` int DEFAULT NULL
);

CREATE TABLE `uomconversion_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `factor` double DEFAULT NULL,
  `fromUomId` int DEFAULT NULL,
  `multiply` double DEFAULT NULL,
  `toUomId` int DEFAULT NULL
);

CREATE TABLE `useraccess_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `groupId` int DEFAULT NULL,
  `modifyFlag` bit(1) DEFAULT NULL,
  `moduleName` varchar(256) DEFAULT NULL,
  `viewFlag` bit(1) DEFAULT NULL
);

CREATE TABLE `usergroup_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `name` varchar(30) DEFAULT NULL
);

CREATE TABLE `usergrouprel_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `groupId` int DEFAULT NULL,
  `userId` int DEFAULT NULL
);

CREATE TABLE `userproperties_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `categoryId` int DEFAULT NULL,
  `subCategory1` varchar(252) DEFAULT NULL,
  `subCategory2` varchar(41) DEFAULT NULL,
  `sysProperty` varchar(41) DEFAULT NULL,
  `userId` int DEFAULT NULL,
  `userKey` varchar(41) DEFAULT NULL,
  `userValue` longtext
);

CREATE TABLE `usertolg_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `defaultFlag` bit(1) DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `userId` int DEFAULT NULL
);

CREATE TABLE `vendor_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `accountId` int DEFAULT NULL,
  `accountNum` varchar(30) DEFAULT NULL,
  `accountingHash` varchar(30) DEFAULT NULL,
  `accountingId` varchar(36) DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `creditLimit` decimal(28,9) DEFAULT NULL,
  `currencyId` int DEFAULT NULL,
  `currencyRate` decimal(28,9) DEFAULT NULL,
  `dateEntered` datetime(6) DEFAULT NULL,
  `defaultCarrierId` int DEFAULT NULL,
  `defaultCarrierServiceId` int DEFAULT NULL,
  `defaultPaymentTermsId` int DEFAULT NULL,
  `defaultShipTermsId` int DEFAULT NULL,
  `lastChangedUser` varchar(100) DEFAULT NULL,
  `leadTime` int DEFAULT NULL,
  `minOrderAmount` decimal(28,9) DEFAULT NULL,
  `name` varchar(41) DEFAULT NULL,
  `note` varchar(256) DEFAULT NULL,
  `statusId` int DEFAULT NULL,
  `sysUserId` int DEFAULT NULL,
  `taxRateId` int DEFAULT NULL,
  `url` varchar(256) DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `vendorcostrule_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `description` varchar(252) DEFAULT NULL,
  `name` varchar(70) DEFAULT NULL,
  `partId` int DEFAULT NULL,
  `qty` decimal(28,9) DEFAULT NULL,
  `unitCost` decimal(28,9) DEFAULT NULL,
  `userId` int DEFAULT NULL,
  `vendorId` int DEFAULT NULL
);

CREATE TABLE `vendorparts_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `defaultFlag` bit(1) DEFAULT NULL,
  `lastCost` decimal(28,9) DEFAULT NULL,
  `lastDate` datetime(6) DEFAULT NULL,
  `leadTime` int DEFAULT NULL,
  `partId` int DEFAULT NULL,
  `qtyMax` decimal(28,9) DEFAULT NULL,
  `qtyMin` decimal(28,9) DEFAULT NULL,
  `uomId` int DEFAULT NULL,
  `userId` int DEFAULT NULL,
  `vendorId` int DEFAULT NULL,
  `vendorPartNumber` varchar(70) DEFAULT NULL
);

CREATE TABLE `watch_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `alertLevel` decimal(28,9) DEFAULT NULL,
  `columnName` varchar(60) DEFAULT NULL,
  `comparison` int DEFAULT NULL,
  `criticalLevel` decimal(28,9) DEFAULT NULL,
  `itemDesc` varchar(90) DEFAULT NULL,
  `itemId` int DEFAULT NULL,
  `lgSumTypeId` int DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `strId` varchar(30) DEFAULT NULL,
  `sysUserId` int DEFAULT NULL,
  `tableId` int DEFAULT NULL,
  `typeId` int DEFAULT NULL
);

CREATE TABLE `wo_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `calCategoryId` int DEFAULT NULL,
  `cost` decimal(28,9) DEFAULT NULL,
  `customerId` int DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateFinished` datetime(6) DEFAULT NULL,
  `dateScheduled` datetime(6) DEFAULT NULL,
  `dateScheduledToStart` datetime(6) DEFAULT NULL,
  `dateStarted` datetime(6) DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `locationId` int DEFAULT NULL,
  `moItemId` int DEFAULT NULL,
  `note` longtext,
  `num` varchar(30) DEFAULT NULL,
  `priorityId` int DEFAULT NULL,
  `qbClassId` int DEFAULT NULL,
  `qtyOrdered` int DEFAULT NULL,
  `qtyScrapped` int DEFAULT NULL,
  `qtyTarget` int DEFAULT NULL,
  `statusId` int DEFAULT NULL,
  `userId` int DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `woassignedusers_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `userId` int DEFAULT NULL,
  `woId` int DEFAULT NULL
);

CREATE TABLE `woinstruction_aud` (
  `id` bigint NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `bomInstructionItemId` bigint DEFAULT NULL,
  `dateFirstReady` datetime(6) DEFAULT NULL,
  `dateLastFulfilled` datetime(6) DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `details` longtext,
  `name` varchar(256) DEFAULT NULL,
  `qtyFulfilled` int DEFAULT NULL,
  `qtyReady` int DEFAULT NULL,
  `sortOrder` int DEFAULT NULL,
  `url` varchar(256) DEFAULT NULL,
  `woId` int DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `woitem_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `cost` decimal(28,9) DEFAULT NULL,
  `standardCost` decimal(28,9) DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `moItemId` int DEFAULT NULL,
  `partId` int DEFAULT NULL,
  `qtyScrapped` decimal(28,9) DEFAULT NULL,
  `qtyTarget` decimal(28,9) DEFAULT NULL,
  `qtyUsed` decimal(28,9) DEFAULT NULL,
  `sortId` int DEFAULT NULL,
  `typeId` int DEFAULT NULL,
  `uomId` int DEFAULT NULL,
  `woId` int DEFAULT NULL,
  `oneTimeItem` tinyint DEFAULT NULL
);

CREATE TABLE `xo_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `carrierId` int DEFAULT NULL,
  `carrierServiceId` int DEFAULT NULL,
  `dateCompleted` datetime(6) DEFAULT NULL,
  `dateConfirmed` datetime(6) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateFirstShip` datetime(6) DEFAULT NULL,
  `dateIssued` datetime(6) DEFAULT NULL,
  `dateScheduled` datetime(6) DEFAULT NULL,
  `fromAddress` varchar(90) DEFAULT NULL,
  `fromAttn` varchar(60) DEFAULT NULL,
  `fromCity` varchar(30) DEFAULT NULL,
  `fromCountryId` int DEFAULT NULL,
  `fromLGId` int DEFAULT NULL,
  `fromName` varchar(41) DEFAULT NULL,
  `fromStateId` int DEFAULT NULL,
  `fromZip` varchar(10) DEFAULT NULL,
  `mainLocationTagId` bigint DEFAULT NULL,
  `note` longtext,
  `num` varchar(25) DEFAULT NULL,
  `ownerIsFrom` bit(1) DEFAULT NULL,
  `revisionNum` int DEFAULT NULL,
  `shipToAddress` varchar(90) DEFAULT NULL,
  `shipToAttn` varchar(60) DEFAULT NULL,
  `shipToCity` varchar(30) DEFAULT NULL,
  `shipToCountryId` int DEFAULT NULL,
  `shipToLGId` int DEFAULT NULL,
  `shipToName` varchar(41) DEFAULT NULL,
  `shipToStateId` int DEFAULT NULL,
  `shipToZip` varchar(10) DEFAULT NULL,
  `statusId` int DEFAULT NULL,
  `typeId` int DEFAULT NULL,
  `userId` int DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `xoitem_aud` (
  `id` int NOT NULL,
  `REV` bigint NOT NULL,
  `REVTYPE` tinyint DEFAULT NULL,
  `dateLastFulfillment` datetime(6) DEFAULT NULL,
  `dateScheduledFulfillment` datetime(6) DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `lineItem` int DEFAULT NULL,
  `note` longtext,
  `partId` int DEFAULT NULL,
  `partNum` varchar(70) DEFAULT NULL,
  `qtyFulfilled` decimal(28,9) DEFAULT NULL,
  `qtyPicked` decimal(28,9) DEFAULT NULL,
  `qtyToFulfill` decimal(28,9) DEFAULT NULL,
  `revisionNum` int DEFAULT NULL,
  `statusId` int DEFAULT NULL,
  `totalCost` decimal(28,9) DEFAULT NULL,
  `typeId` int DEFAULT NULL,
  `uomId` int DEFAULT NULL,
  `xoId` int DEFAULT NULL
);
