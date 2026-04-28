-- Fishbowl Advanced Schema: System — Integrations, Scheduling, BI Metadata, Config
-- 40 table(s)
-- Column definitions only. Keys, constraints, and indexes omitted.
-- FK naming convention: fooId -> foo.id  (e.g. customerId -> customer.id)

CREATE TABLE `bireport` (
  `id` int NOT NULL AUTO_INCREMENT,
  `biScriptId` int NOT NULL,
  `data` longtext,
  `params` json DEFAULT NULL,
  `name` varchar(64) DEFAULT NULL,
  `description` longtext,
  `widget` tinyint DEFAULT '0',
  `dateLastModified` datetime(6) DEFAULT NULL
);

CREATE TABLE `bireportaccess` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `userGroupId` int NOT NULL,
  `biReportId` int NOT NULL,
  `accessLevel` varchar(45) NOT NULL
);

CREATE TABLE `biscript` (
  `id` int NOT NULL AUTO_INCREMENT,
  `active` bit(1) DEFAULT NULL,
  `data` longtext,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `description` longtext,
  `name` varchar(64) NOT NULL,
  `note` longtext,
  `typeId` int NOT NULL,
  `fbVersion` int DEFAULT NULL,
  `fbName` varchar(64) DEFAULT NULL,
  `published` tinyint NOT NULL DEFAULT '0'
);

CREATE TABLE `calcategory` (
  `id` int NOT NULL AUTO_INCREMENT,
  `color` varchar(32) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `lastChangedUserId` int NOT NULL,
  `name` varchar(128) DEFAULT NULL,
  `parentID` int DEFAULT NULL,
  `readOnly` bit(1) DEFAULT NULL
);

CREATE TABLE `calevent` (
  `id` int NOT NULL AUTO_INCREMENT,
  `allDay` bit(1) DEFAULT NULL,
  `calCategoryId` int DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateEnd` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `dateStart` datetime(6) DEFAULT NULL,
  `lastChangedUserId` int NOT NULL,
  `location` varchar(128) DEFAULT NULL,
  `name` varchar(128) DEFAULT NULL,
  `note` longtext
);

CREATE TABLE `databaseversion` (
  `id` int NOT NULL AUTO_INCREMENT,
  `alterCommand` longtext,
  `dateUpdated` datetime(6) DEFAULT NULL,
  `version` int NOT NULL
);

CREATE TABLE `fbschedule` (
  `id` int NOT NULL AUTO_INCREMENT,
  `actionSubType` varchar(100) DEFAULT NULL,
  `actionTypeId` int DEFAULT NULL,
  `activeFlag` bit(1) DEFAULT NULL,
  `cronString` varchar(90) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `dateNextScheduled` datetime(6) DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `directory` varchar(255) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `emailReport` varchar(255) DEFAULT NULL,
  `fileMask` varchar(30) DEFAULT NULL,
  `fileName` varchar(30) DEFAULT NULL,
  `javaClass` varchar(255) DEFAULT NULL,
  `lastChangedUserId` int NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `parameters` varchar(255) DEFAULT NULL,
  `reportId` int DEFAULT NULL,
  `pluginManaged` bit(1) NOT NULL DEFAULT 0,
  `deleteBackupOlderThan` int NOT NULL DEFAULT 0
);

CREATE TABLE `fbscheduleactiontype` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `fbschedulehistory` (
  `id` int NOT NULL AUTO_INCREMENT,
  `error` longtext,
  `lastRunTime` datetime(6) DEFAULT NULL,
  `scheduleId` int DEFAULT NULL
);

CREATE TABLE `fbschedulereportparameter` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(64) DEFAULT NULL,
  `paramValue` varchar(256) DEFAULT NULL,
  `scheduleId` int NOT NULL
);

CREATE TABLE `guiproperties` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userid` int DEFAULT NULL,
  `properties` longtext
);

CREATE TABLE `integratedapp` (
  `id` int NOT NULL AUTO_INCREMENT,
  `appKey` varchar(15) NOT NULL,
  `authorized` bit(1) NOT NULL,
  `description` varchar(256) DEFAULT NULL,
  `lastActivity` datetime(6) DEFAULT NULL,
  `name` varchar(41) NOT NULL,
  `statusId` int DEFAULT NULL
);

CREATE TABLE `integratedappstatus` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL
);

CREATE TABLE `lgsumtype` (
  `id` int NOT NULL,
  `name` varchar(20) NOT NULL
);

CREATE TABLE `module` (
  `id` int NOT NULL AUTO_INCREMENT,
  `reportId` int DEFAULT NULL,
  `isModule` bit(1) DEFAULT NULL,
  `name` varchar(41) DEFAULT NULL
);

CREATE TABLE `notification` (
  `id` int NOT NULL AUTO_INCREMENT,
  `typeId` int NOT NULL,
  `userId` int NOT NULL,
  `locationGroupId` int NOT NULL,
  `activeFlag` bit(1) NOT NULL
);

CREATE TABLE `notificationtype` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL
);

CREATE TABLE `objecttoobject` (
  `id` int NOT NULL AUTO_INCREMENT,
  `note` varchar(30) DEFAULT NULL,
  `recordId1` int NOT NULL,
  `recordId2` int NOT NULL,
  `tableId1` int NOT NULL,
  `tableId2` int NOT NULL,
  `typeId` int NOT NULL
);

CREATE TABLE `objecttoobjecttype` (
  `id` int NOT NULL,
  `description` varchar(256) NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `orderhistory` (
  `id` int NOT NULL AUTO_INCREMENT,
  `comment` varchar(90) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `orderId` int DEFAULT NULL,
  `orderTypeId` int NOT NULL,
  `recordId` int DEFAULT NULL,
  `tableId` int DEFAULT NULL,
  `userId` int NOT NULL
);

CREATE TABLE `ordertype` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `plugindata` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dataKey` varchar(255) DEFAULT NULL,
  `groupName` varchar(255) DEFAULT NULL,
  `info` longtext,
  `plugin` varchar(255) NOT NULL
);

CREATE TABLE `plugininfo` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `channelId` varchar(255) NOT NULL,
  `groupId` int NOT NULL,
  `info` json DEFAULT NULL,
  `plugin` varchar(255) NOT NULL,
  `recordId` int NOT NULL,
  `tableName` varchar(255) NOT NULL
);

CREATE TABLE `pluginproperties` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dataKey` varchar(255) DEFAULT NULL,
  `info` varchar(255) DEFAULT NULL,
  `plugin` varchar(255) NOT NULL
);

CREATE TABLE `quicklist` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customerId` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `quicklistitem` (
  `id` int NOT NULL AUTO_INCREMENT,
  `productId` int NOT NULL,
  `qListId` int NOT NULL,
  `quantity` decimal(28,9) DEFAULT NULL
);

CREATE TABLE `report` (
  `id` int NOT NULL AUTO_INCREMENT,
  `activeFlag` bit(1) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `description` longtext,
  `lastChangedUserId` int NOT NULL,
  `name` varchar(64) DEFAULT NULL,
  `path` varchar(256) DEFAULT NULL,
  `readOnly` bit(1) DEFAULT NULL,
  `reportTreeId` int DEFAULT NULL,
  `userId` int DEFAULT NULL
);

CREATE TABLE `reportparameter` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  `paramValue` varchar(255) DEFAULT NULL,
  `REPORTID` int DEFAULT NULL
);

CREATE TABLE `reporttomodule` (
  `id` int NOT NULL AUTO_INCREMENT,
  `moduleId` int NOT NULL,
  `reportId` int NOT NULL
);

CREATE TABLE `reporttree` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  `parentId` int DEFAULT NULL,
  `readOnly` bit(1) DEFAULT NULL,
  `userId` int DEFAULT NULL
);

CREATE TABLE `responsibility` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `revinfo` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `modifiedUserId` int DEFAULT NULL,
  `timestamp` datetime(6) DEFAULT NULL
);

CREATE TABLE `rndtype` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `sysproperties` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `owner` varchar(30) DEFAULT NULL,
  `readAllowed` bit(1) NOT NULL,
  `sysKey` varchar(30) NOT NULL,
  `sysValue` varchar(3072) NOT NULL,
  `writeAllowed` bit(1) NOT NULL
);

CREATE TABLE `tablereference` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tableId` int NOT NULL,
  `tableRefName` varchar(30) NOT NULL,
  `displayName` varchar(30) DEFAULT NULL,
  `customFieldsFlag` bit(1) NOT NULL
);

CREATE TABLE `trusteddevice` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sysUserId` int NOT NULL,
  `deviceId` varchar(256) NOT NULL,
  `expirationDate` date NOT NULL
);

CREATE TABLE `userlog` (
  `id` int NOT NULL AUTO_INCREMENT,
  `eventDate` datetime(6) DEFAULT NULL,
  `isLogin` bit(1) NOT NULL,
  `userId` int NOT NULL,
  `isMfa` bit(1) NOT NULL DEFAULT false
);

CREATE TABLE `userproperties` (
  `id` int NOT NULL AUTO_INCREMENT,
  `categoryId` int NOT NULL,
  `subCategory1` varchar(252) DEFAULT NULL,
  `subCategory2` varchar(41) DEFAULT NULL,
  `sysProperty` varchar(41) DEFAULT NULL,
  `userId` int NOT NULL,
  `userKey` varchar(41) NOT NULL,
  `userValue` longtext NOT NULL
);

CREATE TABLE `watch` (
  `id` int NOT NULL AUTO_INCREMENT,
  `alertLevel` decimal(28,9) NOT NULL,
  `columnName` varchar(60) DEFAULT NULL,
  `comparison` int NOT NULL,
  `criticalLevel` decimal(28,9) NOT NULL,
  `itemDesc` varchar(90) DEFAULT NULL,
  `itemId` int NOT NULL,
  `lgSumTypeId` int DEFAULT NULL,
  `locationGroupId` int DEFAULT NULL,
  `strId` varchar(30) DEFAULT NULL,
  `sysUserId` int NOT NULL,
  `tableId` int NOT NULL,
  `typeId` int NOT NULL
);

CREATE TABLE `watchtype` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(15) NOT NULL
);
