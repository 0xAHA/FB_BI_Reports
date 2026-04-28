-- Fishbowl Advanced Schema: Setup & Reference — Users, Currency, Carrier, Terms, Fields
-- 39 table(s)
-- Column definitions only. Keys, constraints, and indexes omitted.
-- FK naming convention: fooId -> foo.id  (e.g. customerId -> customer.id)

CREATE TABLE `account` (
  `id` int NOT NULL AUTO_INCREMENT,
  `typeId` int DEFAULT NULL
);

CREATE TABLE `accountgroup` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(30) DEFAULT NULL
);

CREATE TABLE `accountgrouprelation` (
  `id` int NOT NULL AUTO_INCREMENT,
  `accountId` int DEFAULT NULL,
  `groupId` int DEFAULT NULL
);

CREATE TABLE `accounttype` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `asaccount` (
  `id` int NOT NULL AUTO_INCREMENT,
  `accountNumber` varchar(36) DEFAULT NULL,
  `accountingHash` varchar(30) DEFAULT NULL,
  `accountingId` varchar(36) DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `name` varchar(155) NOT NULL,
  `typeId` int DEFAULT NULL
);

CREATE TABLE `asaccounttype` (
  `id` int NOT NULL,
  `name` varchar(31) NOT NULL
);

CREATE TABLE `carrier` (
  `id` int NOT NULL AUTO_INCREMENT,
  `activeFlag` bit(1) DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `name` varchar(60) DEFAULT NULL,
  `readOnly` bit(1) DEFAULT NULL,
  `scac` varchar(4) DEFAULT NULL
);

CREATE TABLE `carrierservice` (
  `id` int NOT NULL AUTO_INCREMENT,
  `activeFlag` bit(1) NOT NULL,
  `carrierId` int NOT NULL,
  `code` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `readOnly` bit(1) NOT NULL
);

CREATE TABLE `cartontype` (
  `id` int NOT NULL AUTO_INCREMENT,
  `defaultFlag` bit(1) NOT NULL,
  `description` varchar(252) DEFAULT NULL,
  `height` decimal(28,9) DEFAULT NULL,
  `len` decimal(28,9) DEFAULT NULL,
  `name` varchar(70) NOT NULL,
  `sizeUOM` varchar(30) DEFAULT NULL,
  `width` decimal(28,9) DEFAULT NULL
);

CREATE TABLE `company` (
  `id` int NOT NULL AUTO_INCREMENT,
  `EANUCCPrefix` varchar(30) DEFAULT NULL,
  `abn` varchar(25) DEFAULT NULL,
  `accountId` int NOT NULL,
  `dateEntered` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `defaultCarrierId` int DEFAULT NULL,
  `defaultFlag` bit(1) NOT NULL,
  `lastChangedUser` varchar(100) DEFAULT NULL,
  `name` varchar(60) NOT NULL,
  `taxExempt` bit(1) NOT NULL,
  `TAXEXEMPTNUMBER` varchar(30) DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `countryconst` (
  `id` int NOT NULL AUTO_INCREMENT,
  `abbreviation` varchar(10) DEFAULT NULL,
  `name` varchar(64) DEFAULT NULL
);

CREATE TABLE `currency` (
  `id` int NOT NULL AUTO_INCREMENT,
  `activeFlag` bit(1) DEFAULT NULL,
  `code` varchar(3) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `excludeFromUpdate` bit(1) DEFAULT NULL,
  `homeCurrency` bit(1) DEFAULT NULL,
  `lastChangedUserId` int NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `rate` decimal(28,9) DEFAULT NULL,
  `symbol` int DEFAULT NULL
);

CREATE TABLE `customfield` (
  `id` int NOT NULL AUTO_INCREMENT,
  `accessRight` bit(1) NOT NULL,
  `activeFlag` bit(1) NOT NULL,
  `customFieldTypeId` int NOT NULL,
  `description` varchar(256) DEFAULT NULL,
  `listId` int DEFAULT NULL,
  `name` varchar(41) NOT NULL,
  `required` bit(1) NOT NULL,
  `sortOrder` int NOT NULL,
  `tableId` int NOT NULL
);

CREATE TABLE `customfieldtype` (
  `id` int NOT NULL AUTO_INCREMENT,
  `description` varchar(256) DEFAULT NULL,
  `name` varchar(41) NOT NULL
);

CREATE TABLE `customlist` (
  `id` int NOT NULL AUTO_INCREMENT,
  `description` varchar(256) DEFAULT NULL,
  `name` varchar(41) NOT NULL
);

CREATE TABLE `customlistitem` (
  `id` int NOT NULL AUTO_INCREMENT,
  `description` varchar(256) DEFAULT NULL,
  `listId` int DEFAULT NULL,
  `name` varchar(41) NOT NULL
);

CREATE TABLE `dataexport` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dataQuery` longtext,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `lastChangedUserId` int DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL
);

CREATE TABLE `fobpoint` (
  `id` int NOT NULL AUTO_INCREMENT,
  `activeFlag` bit(1) DEFAULT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `image` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `imageFull` longtext,
  `imageThumbnail` longtext,
  `recordId` int NOT NULL,
  `tableName` varchar(150) NOT NULL,
  `type` varchar(50) NOT NULL
);

CREATE TABLE `issuablestatus` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(15) DEFAULT NULL
);

CREATE TABLE `memo` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dateCreated` datetime(6) DEFAULT NULL,
  `memo` longtext,
  `recordId` int NOT NULL,
  `tableId` int NOT NULL,
  `userName` varchar(100) DEFAULT NULL
);

CREATE TABLE `pabaseamounttype` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `patype` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `paymentterms` (
  `id` int NOT NULL AUTO_INCREMENT,
  `accountingHash` varchar(30) DEFAULT NULL,
  `accountingId` varchar(36) DEFAULT NULL,
  `activeFlag` bit(1) NOT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `defaultTerm` bit(1) NOT NULL,
  `discount` double DEFAULT NULL,
  `discountDays` int DEFAULT NULL,
  `name` varchar(31) NOT NULL,
  `netDays` int DEFAULT NULL,
  `nextMonth` int DEFAULT NULL,
  `readOnly` bit(1) NOT NULL,
  `typeId` int NOT NULL
);

CREATE TABLE `paymenttermstype` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `pricingrule` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customerInclId` int DEFAULT NULL,
  `customerInclTypeId` int NOT NULL,
  `dateApplies` bit(1) NOT NULL,
  `dateBegin` datetime(6) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateEnd` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `description` longtext,
  `isActive` bit(1) NOT NULL,
  `isAutoApply` bit(1) NOT NULL,
  `isTier2` bit(1) NOT NULL,
  `name` varchar(41) NOT NULL,
  `paAmount` decimal(28,9) DEFAULT NULL,
  `paApplies` bit(1) NOT NULL,
  `paBaseAmountTypeId` int DEFAULT NULL,
  `paPercent` decimal(28,9) DEFAULT NULL,
  `paTypeId` int DEFAULT NULL,
  `productInclId` int DEFAULT NULL,
  `productInclTypeId` int NOT NULL,
  `qtyApplies` bit(1) NOT NULL,
  `qtyMax` decimal(28,9) DEFAULT NULL,
  `qtyMin` decimal(28,9) DEFAULT NULL,
  `rndApplies` bit(1) NOT NULL,
  `rndIsMinus` bit(1) NOT NULL,
  `rndPMAmount` decimal(28,9) DEFAULT NULL,
  `rndToAmount` decimal(28,9) DEFAULT NULL,
  `rndTypeId` int DEFAULT NULL,
  `spcApplies` bit(1) NOT NULL,
  `spcBuyX` int DEFAULT NULL,
  `spcGetYFree` int DEFAULT NULL,
  `userId` int NOT NULL
);

CREATE TABLE `priority` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `propertycategory` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(41) NOT NULL
);

CREATE TABLE `qbclass` (
  `id` int NOT NULL AUTO_INCREMENT,
  `accountingHash` varchar(30) DEFAULT NULL,
  `accountingId` varchar(36) DEFAULT NULL,
  `activeFlag` bit(1) NOT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `name` varchar(31) NOT NULL,
  `parentId` int NOT NULL
);

CREATE TABLE `register` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `shipterms` (
  `id` int NOT NULL AUTO_INCREMENT,
  `activeFlag` bit(1) NOT NULL,
  `name` varchar(30) NOT NULL,
  `readOnly` bit(1) NOT NULL
);

CREATE TABLE `stateconst` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(21) NOT NULL,
  `countryConstID` int NOT NULL,
  `name` varchar(60) NOT NULL
);

CREATE TABLE `sysuser` (
  `id` int NOT NULL AUTO_INCREMENT,
  `activeFlag` bit(1) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `firstName` varchar(15) DEFAULT NULL,
  `initials` varchar(5) DEFAULT NULL,
  `lastName` varchar(15) DEFAULT NULL,
  `phone` varchar(255) DEFAULT NULL,
  `userName` varchar(100) NOT NULL,
  `userPwd` varchar(255) NOT NULL,
  `passwordLastModified` datetime(6) DEFAULT NULL,
  `passwordExpiration` datetime(6) DEFAULT NULL,
  `mfaSecret` varchar(64) NOT NULL,
  `mfaBypassCounter` int NOT NULL DEFAULT 0,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `taxrate` (
  `id` int NOT NULL AUTO_INCREMENT,
  `accountingHash` varchar(30) DEFAULT NULL,
  `accountingId` varchar(36) DEFAULT NULL,
  `activeFlag` bit(1) NOT NULL,
  `code` varchar(5) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `defaultFlag` bit(1) NOT NULL,
  `description` varchar(256) DEFAULT NULL,
  `name` varchar(31) NOT NULL,
  `orderTypeId` int DEFAULT NULL,
  `rate` double DEFAULT NULL,
  `taxAccountId` int DEFAULT NULL,
  `typeCode` varchar(50) DEFAULT NULL,
  `typeId` int NOT NULL,
  `unitCost` decimal(28,9) DEFAULT NULL,
  `vendorId` int DEFAULT NULL
);

CREATE TABLE `taxratetype` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `useraccess` (
  `id` int NOT NULL AUTO_INCREMENT,
  `groupId` int NOT NULL,
  `modifyFlag` bit(1) DEFAULT NULL,
  `moduleName` varchar(256) NOT NULL,
  `viewFlag` bit(1) DEFAULT NULL
);

CREATE TABLE `usergroup` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `usergrouprel` (
  `id` int NOT NULL AUTO_INCREMENT,
  `groupId` int NOT NULL,
  `userId` int NOT NULL
);

CREATE TABLE `usertolg` (
  `id` int NOT NULL AUTO_INCREMENT,
  `defaultFlag` bit(1) NOT NULL,
  `locationGroupId` int DEFAULT NULL,
  `userId` int NOT NULL
);
