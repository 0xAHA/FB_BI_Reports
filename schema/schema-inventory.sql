-- Fishbowl Advanced Schema: Inventory — Tag, Location, Tracking, Cost
-- 29 table(s)
-- Column definitions only. Keys, constraints, and indexes omitted.
-- FK naming convention: fooId -> foo.id  (e.g. customerId -> customer.id)

CREATE TABLE `costlayer` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dateCreated` datetime(6) NOT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `orgQty` decimal(28,9) NOT NULL,
  `orgTotalCost` decimal(28,9) NOT NULL,
  `partId` int NOT NULL,
  `qty` decimal(28,9) NOT NULL,
  `recordId` bigint DEFAULT NULL,
  `statusId` int NOT NULL,
  `tableId` int DEFAULT NULL,
  `totalCost` decimal(28,9) NOT NULL
);

CREATE TABLE `costlayerstatus` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `defaultlocation` (
  `id` int NOT NULL AUTO_INCREMENT,
  `locationGroupId` int NOT NULL,
  `locationId` int NOT NULL,
  `partId` int NOT NULL
);

CREATE TABLE `inventorylog` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `begLocationId` int NOT NULL,
  `begTagNum` bigint DEFAULT NULL,
  `changeQty` decimal(28,9) DEFAULT NULL,
  `cost` decimal(28,9) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `endLocationId` int NOT NULL,
  `endTagNum` bigint DEFAULT NULL,
  `eventDate` datetime(6) DEFAULT NULL,
  `info` varchar(100) DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `partId` int NOT NULL,
  `partTrackingId` int DEFAULT NULL,
  `qtyOnHand` decimal(28,9) DEFAULT NULL,
  `recordId` bigint DEFAULT NULL,
  `tableId` int DEFAULT NULL,
  `typeId` int NOT NULL,
  `userId` int NOT NULL
);

CREATE TABLE `inventorylogtocostlayer` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `costLayerId` int NOT NULL,
  `inventoryLogId` bigint NOT NULL,
  `qty` decimal(28,9) NOT NULL
);

CREATE TABLE `inventorylogtype` (
  `id` int NOT NULL,
  `description` varchar(256) NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `itemadjust` (
  `id` int NOT NULL AUTO_INCREMENT,
  `activeFlag` bit(1) NOT NULL,
  `amount` decimal(28,9) DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `expenseAsAccountId` int DEFAULT NULL,
  `incomeAsAccountId` int DEFAULT NULL,
  `name` varchar(31) NOT NULL,
  `percentage` decimal(28,9) DEFAULT NULL,
  `taxRateId` int DEFAULT NULL,
  `taxableFlag` bit(1) NOT NULL,
  `typeId` int NOT NULL
);

CREATE TABLE `itemadjusttype` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `location` (
  `id` int NOT NULL AUTO_INCREMENT,
  `activeFlag` bit(1) NOT NULL,
  `countedAsAvailable` bit(1) NOT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `defaultCustomerId` int DEFAULT NULL,
  `defaultFlag` bit(1) NOT NULL,
  `defaultVendorId` int DEFAULT NULL,
  `description` varchar(252) DEFAULT NULL,
  `locationGroupId` int NOT NULL,
  `name` varchar(30) NOT NULL,
  `parentId` int DEFAULT NULL,
  `pickable` bit(1) NOT NULL,
  `receivable` bit(1) NOT NULL,
  `sortOrder` int DEFAULT NULL,
  `typeId` int NOT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `locationgroup` (
  `id` int NOT NULL AUTO_INCREMENT,
  `activeFlag` bit(1) NOT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `name` varchar(30) NOT NULL,
  `qbClassId` int DEFAULT NULL
);

CREATE TABLE `locationtype` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `partcost` (
  `id` int NOT NULL AUTO_INCREMENT,
  `avgCost` decimal(28,9) NOT NULL,
  `dateCreated` datetime(6) NOT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `partId` int NOT NULL,
  `qty` decimal(28,9) NOT NULL,
  `totalCost` decimal(28,9) NOT NULL
);

CREATE TABLE `partcosthistory` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `avgCost` decimal(28,9) DEFAULT NULL,
  `dateCaptured` datetime(6) NOT NULL,
  `nextCost` decimal(28,9) DEFAULT NULL,
  `partId` int NOT NULL,
  `quantity` decimal(28,9) DEFAULT NULL,
  `stdCost` decimal(28,9) DEFAULT NULL,
  `totalCost` decimal(28,9) DEFAULT NULL
);

CREATE TABLE `partreorder` (
  `id` int NOT NULL AUTO_INCREMENT,
  `locationGroupId` int DEFAULT NULL,
  `orderUpToLevel` decimal(28,9) DEFAULT NULL,
  `partId` int NOT NULL,
  `reorderPoint` decimal(28,9) DEFAULT NULL
);

CREATE TABLE `parttotracking` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nextValue` varchar(41) DEFAULT NULL,
  `partId` int NOT NULL,
  `partTrackingId` int NOT NULL,
  `primaryFlag` bit(1) DEFAULT NULL
);

CREATE TABLE `parttracking` (
  `id` int NOT NULL AUTO_INCREMENT,
  `abbr` varchar(10) NOT NULL,
  `activeFlag` bit(1) NOT NULL,
  `description` varchar(256) DEFAULT NULL,
  `name` varchar(41) NOT NULL,
  `sortOrder` int NOT NULL,
  `typeId` int NOT NULL,
  `gs1Code` int DEFAULT NULL
);

CREATE TABLE `parttrackingtype` (
  `id` int NOT NULL,
  `name` varchar(20) NOT NULL
);

CREATE TABLE `serial` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `committedFlag` bit(1) NOT NULL,
  `tagId` bigint NOT NULL
);

CREATE TABLE `serialnum` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `partTrackingId` int NOT NULL,
  `serialId` bigint NOT NULL,
  `serialNum` varchar(256) NOT NULL
);

CREATE TABLE `tag` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastCycleCount` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `locationId` int NOT NULL,
  `num` bigint NOT NULL,
  `partId` int DEFAULT NULL,
  `qty` decimal(28,9) NOT NULL,
  `qtyCommitted` decimal(28,9) DEFAULT NULL,
  `serializedFlag` bit(1) NOT NULL,
  `trackingEncoding` varchar(30) NOT NULL,
  `typeId` int NOT NULL,
  `usedFlag` bit(1) NOT NULL,
  `woItemId` int DEFAULT NULL
);

CREATE TABLE `tagtype` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `tiinventorylog` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `info` varchar(256) DEFAULT NULL,
  `infoDate` datetime(6) DEFAULT NULL,
  `infoDouble` double DEFAULT NULL,
  `infoInteger` int DEFAULT NULL,
  `inventoryLogId` bigint NOT NULL,
  `partTrackingId` int NOT NULL,
  `qty` decimal(28,9) NOT NULL
);

CREATE TABLE `tiinventorylogsn` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `partTrackingId` int NOT NULL,
  `serialNum` varchar(256) DEFAULT NULL,
  `tiInventoryLogId` bigint NOT NULL
);

CREATE TABLE `trackingdate` (
  `id` int NOT NULL AUTO_INCREMENT,
  `info` datetime(6) NOT NULL,
  `partTrackingId` int NOT NULL,
  `tagId` bigint NOT NULL
);

CREATE TABLE `trackingdecimal` (
  `id` int NOT NULL AUTO_INCREMENT,
  `info` double NOT NULL,
  `partTrackingId` int NOT NULL,
  `tagId` bigint NOT NULL
);

CREATE TABLE `trackinginfo` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `info` varchar(256) DEFAULT NULL,
  `infoDate` datetime(6) DEFAULT NULL,
  `infoDouble` double DEFAULT NULL,
  `infoInteger` int DEFAULT NULL,
  `partTrackingId` int NOT NULL,
  `qty` decimal(28,9) NOT NULL,
  `recordId` int NOT NULL,
  `tableId` int NOT NULL
);

CREATE TABLE `trackinginfosn` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `partTrackingId` int NOT NULL,
  `serialNum` varchar(256) DEFAULT NULL,
  `trackingInfoId` bigint NOT NULL
);

CREATE TABLE `trackinginteger` (
  `id` int NOT NULL AUTO_INCREMENT,
  `info` int NOT NULL,
  `partTrackingId` int NOT NULL,
  `tagId` bigint NOT NULL
);

CREATE TABLE `trackingtext` (
  `id` int NOT NULL AUTO_INCREMENT,
  `info` varchar(256) DEFAULT NULL,
  `partTrackingId` int DEFAULT NULL,
  `tagId` bigint DEFAULT NULL
);
