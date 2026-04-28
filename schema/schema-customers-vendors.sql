-- Fishbowl Advanced Schema: Customers & Vendors — Customer, Vendor, Address, Pricing
-- 16 table(s)
-- Column definitions only. Keys, constraints, and indexes omitted.
-- FK naming convention: fooId -> foo.id  (e.g. customerId -> customer.id)

CREATE TABLE `address` (
  `id` int NOT NULL AUTO_INCREMENT,
  `accountId` int NOT NULL,
  `name` varchar(60) NOT NULL,
  `city` varchar(30) DEFAULT NULL,
  `countryId` int DEFAULT NULL,
  `defaultFlag` bit(1) NOT NULL,
  `locationGroupId` int DEFAULT NULL,
  `addressName` varchar(90) NOT NULL,
  `residentialFlag` bit(1) NOT NULL,
  `stateId` int DEFAULT NULL,
  `address` varchar(90) NOT NULL,
  `typeID` int NOT NULL,
  `zip` varchar(10) DEFAULT NULL
);

CREATE TABLE `addresstype` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `assocprice` (
  `id` int NOT NULL AUTO_INCREMENT,
  `assocPriceTypeId` int NOT NULL,
  `price` decimal(28,9) DEFAULT NULL,
  `productId` int NOT NULL
);

CREATE TABLE `assocpricetype` (
  `id` int NOT NULL AUTO_INCREMENT,
  `accountId` int DEFAULT NULL,
  `description` varchar(256) DEFAULT NULL,
  `name` varchar(41) NOT NULL,
  `taxableFlag` bit(1) NOT NULL
);

CREATE TABLE `contact` (
  `id` int NOT NULL AUTO_INCREMENT,
  `accountId` int NOT NULL,
  `addressId` int DEFAULT NULL,
  `datus` varchar(255) DEFAULT NULL,
  `defaultFlag` bit(1) DEFAULT NULL,
  `contactName` varchar(30) DEFAULT NULL,
  `typeId` int NOT NULL
);

CREATE TABLE `contacttype` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `customer` (
  `id` int NOT NULL AUTO_INCREMENT,
  `accountId` int NOT NULL,
  `accountingHash` varchar(30) DEFAULT NULL,
  `accountingId` varchar(36) DEFAULT NULL,
  `activeFlag` bit(1) NOT NULL,
  `carrierServiceId` int DEFAULT NULL,
  `creditLimit` decimal(28,9) DEFAULT NULL,
  `currencyId` int DEFAULT NULL,
  `currencyRate` decimal(28,9) DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `defaultCarrierId` int DEFAULT NULL,
  `defaultPaymentTermsId` int NOT NULL,
  `defaultPriorityId` int DEFAULT NULL,
  `defaultSalesmanId` int DEFAULT NULL,
  `defaultShipTermsId` int NOT NULL,
  `jobDepth` int DEFAULT NULL,
  `lastChangedUser` varchar(100) DEFAULT NULL,
  `name` varchar(41) NOT NULL,
  `note` varchar(1024) DEFAULT NULL,
  `number` varchar(30) NOT NULL,
  `parentId` int DEFAULT NULL,
  `qbClassId` int DEFAULT NULL,
  `statusId` int NOT NULL,
  `sysUserId` int DEFAULT NULL,
  `taxExempt` bit(1) NOT NULL,
  `taxExemptNumber` varchar(30) DEFAULT NULL,
  `taxRateId` int DEFAULT NULL,
  `toBeEmailed` bit(1) NOT NULL,
  `toBePrinted` bit(1) NOT NULL,
  `url` varchar(256) DEFAULT NULL,
  `issuableStatusId` int DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `customerincltype` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `customerparts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customerId` int NOT NULL,
  `customerPartNumber` varchar(70) NOT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `dateLastPurchased` datetime(6) DEFAULT NULL,
  `lastChangedUserId` int NOT NULL,
  `lastPrice` decimal(28,9) DEFAULT NULL,
  `productId` int NOT NULL
);

CREATE TABLE `customerstatus` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `paymentmethod` (
  `id` int NOT NULL AUTO_INCREMENT,
  `active` bit(1) NOT NULL,
  `editable` bit(1) NOT NULL,
  `name` varchar(31) DEFAULT NULL,
  `typeId` int NOT NULL,
  `depositAccountId` int DEFAULT NULL
);

CREATE TABLE `paymenttype` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `vendor` (
  `id` int NOT NULL AUTO_INCREMENT,
  `accountId` int NOT NULL,
  `accountNum` varchar(30) DEFAULT NULL,
  `accountingHash` varchar(30) DEFAULT NULL,
  `accountingId` varchar(36) DEFAULT NULL,
  `activeFlag` bit(1) NOT NULL,
  `creditLimit` decimal(28,9) DEFAULT NULL,
  `currencyId` int DEFAULT NULL,
  `currencyRate` decimal(28,9) DEFAULT NULL,
  `dateEntered` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `defaultCarrierId` int NOT NULL,
  `defaultCarrierServiceId` int DEFAULT NULL,
  `defaultPaymentTermsId` int NOT NULL,
  `defaultShipTermsId` int NOT NULL,
  `lastChangedUser` varchar(100) DEFAULT NULL,
  `leadTime` int DEFAULT NULL,
  `minOrderAmount` decimal(28,9) DEFAULT NULL,
  `name` varchar(41) NOT NULL,
  `note` varchar(256) DEFAULT NULL,
  `statusId` int NOT NULL,
  `sysUserId` int DEFAULT NULL,
  `taxRateId` int DEFAULT NULL,
  `url` varchar(256) DEFAULT NULL,
  `customFields` json DEFAULT NULL
);

CREATE TABLE `vendorcostrule` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `description` varchar(252) DEFAULT NULL,
  `name` varchar(70) NOT NULL,
  `partId` int NOT NULL,
  `qty` decimal(28,9) DEFAULT NULL,
  `unitCost` decimal(28,9) DEFAULT NULL,
  `userId` int NOT NULL,
  `vendorId` int NOT NULL
);

CREATE TABLE `vendorparts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `defaultFlag` bit(1) NOT NULL,
  `lastCost` decimal(28,9) DEFAULT NULL,
  `lastDate` datetime(6) DEFAULT NULL,
  `leadTime` int DEFAULT NULL,
  `partId` int NOT NULL,
  `qtyMax` decimal(28,9) DEFAULT NULL,
  `qtyMin` decimal(28,9) DEFAULT NULL,
  `uomId` int NOT NULL,
  `userId` int NOT NULL,
  `vendorId` int NOT NULL,
  `vendorPartNumber` varchar(70) NOT NULL
);

CREATE TABLE `vendorstatus` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);
