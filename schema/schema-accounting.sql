-- Fishbowl Advanced Schema: Accounting — QB Posting, Transactions, Payment Processing
-- 19 table(s)
-- Column definitions only. Keys, constraints, and indexes omitted.
-- FK naming convention: fooId -> foo.id  (e.g. customerId -> customer.id)

CREATE TABLE `accountingexportlog` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dateExportStart` datetime(6) NOT NULL,
  `dateExportEnd` datetime(6) DEFAULT NULL,
  `dateRepostStart` datetime(6) DEFAULT NULL,
  `dateRepostEnd` datetime(6) DEFAULT NULL,
  `typeId` int NOT NULL,
  `sysUserId` int NOT NULL,
  `scheduled` bit(1) NOT NULL,
  `error` longtext DEFAULT NULL
);

CREATE TABLE `accountingexporttype` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `cardonfile` (
  `id` int NOT NULL AUTO_INCREMENT,
  `walletId` int NOT NULL,
  `gatewayPaymentId` varchar(255) NOT NULL,
  `info` varchar(100) DEFAULT NULL,
  `expDate` datetime(6) DEFAULT NULL,
  `paymentMethodId` int NOT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `lastChangedUserId` int NOT NULL
);

CREATE TABLE `paymentgateway` (
  `id` int NOT NULL AUTO_INCREMENT,
  `javaClass` varchar(255) NOT NULL,
  `login` varchar(2048) NOT NULL,
  `name` varchar(150) NOT NULL,
  `other` varchar(255) DEFAULT NULL,
  `other2` varchar(255) DEFAULT NULL,
  `secret` varchar(2048) NOT NULL,
  `dateExpiration` datetime(6) DEFAULT NULL
);

CREATE TABLE `post` (
  `id` int NOT NULL AUTO_INCREMENT,
  `amount` decimal(28,9) DEFAULT NULL,
  `customerId` int DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `datePosted` datetime(6) DEFAULT NULL,
  `editSequence` varchar(16) DEFAULT NULL,
  `orderId` int DEFAULT NULL,
  `orderTypeId` int NOT NULL,
  `postedTotalCost` decimal(28,9) DEFAULT NULL,
  `quantity` decimal(28,9) DEFAULT NULL,
  `refId` int DEFAULT NULL,
  `refItemId` int DEFAULT NULL,
  `refNumber` varchar(20) DEFAULT NULL,
  `serialNum` varchar(30) DEFAULT NULL,
  `statusId` int NOT NULL,
  `txnId` varchar(36) DEFAULT NULL,
  `txnLineId` varchar(36) DEFAULT NULL,
  `typeId` int NOT NULL
);

CREATE TABLE `postatus` (
  `id` int NOT NULL,
  `name` varchar(20) NOT NULL
);

CREATE TABLE `postorderstatus` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `postpo` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dateCreated` datetime(6) NOT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `datePosted` datetime(6) DEFAULT NULL,
  `extRefNumber` varchar(21) DEFAULT NULL,
  `extTxnHash` varchar(16) DEFAULT NULL,
  `extTxnId` varchar(36) DEFAULT NULL,
  `extTxnNumber` int DEFAULT NULL,
  `journalPosted` bit(1) NOT NULL,
  `journalTxnId` varchar(36) DEFAULT NULL,
  `poId` int NOT NULL,
  `postDate` datetime(6) DEFAULT NULL,
  `statusId` int NOT NULL
);

CREATE TABLE `postpoitem` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dateCreated` datetime(6) NOT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `extRefNumber` varchar(21) DEFAULT NULL,
  `extTxnHash` varchar(16) DEFAULT NULL,
  `extTxnId` varchar(36) DEFAULT NULL,
  `extTxnLineId` varchar(36) DEFAULT NULL,
  `poItemId` int DEFAULT NULL,
  `postPoId` int NOT NULL,
  `postedTotalCost` decimal(28,9) DEFAULT NULL,
  `mcPostedTotalCost` decimal(28,9) DEFAULT NULL,
  `qty` decimal(28,9) NOT NULL,
  `receiptItemId` int DEFAULT NULL,
  `shipItemId` int DEFAULT NULL,
  `stdCost` decimal(28,9) DEFAULT NULL,
  `receivedTotalCost` decimal(28,9) NOT NULL DEFAULT '0.000000000'
);

CREATE TABLE `postransaction` (
  `id` int NOT NULL AUTO_INCREMENT,
  `amount` decimal(28,9) DEFAULT NULL,
  `authCode` varchar(100) DEFAULT NULL,
  `changeGiven` decimal(28,9) DEFAULT NULL,
  `confirmation` varchar(30) DEFAULT NULL,
  `currencyRate` decimal(28,9) DEFAULT NULL,
  `dateTime` datetime(6) DEFAULT NULL,
  `depositToAccountId` int DEFAULT NULL,
  `expDate` datetime(6) DEFAULT NULL,
  `merchantActNum` varchar(20) DEFAULT NULL,
  `paymentMethodId` int NOT NULL,
  `soId` int NOT NULL,
  `transactionId` varchar(100) DEFAULT NULL,
  `userId` int NOT NULL,
  `info` varchar(100) DEFAULT NULL
);

CREATE TABLE `postso` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dateCreated` datetime(6) NOT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `datePosted` datetime(6) DEFAULT NULL,
  `extRefNumber` varchar(21) DEFAULT NULL,
  `extTxnHash` varchar(16) DEFAULT NULL,
  `extTxnId` varchar(36) DEFAULT NULL,
  `extTxnNumber` int DEFAULT NULL,
  `journalPosted` bit(1) NOT NULL,
  `journalTxnId` varchar(36) DEFAULT NULL,
  `postDate` datetime(6) DEFAULT NULL,
  `soId` int NOT NULL,
  `statusId` int NOT NULL,
  `totalTax` decimal(28,9) DEFAULT NULL
);

CREATE TABLE `postsoitem` (
  `id` int NOT NULL AUTO_INCREMENT,
  `adjustPercent` double DEFAULT NULL,
  `dateCreated` datetime(6) DEFAULT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `extRefNumber` varchar(21) DEFAULT NULL,
  `extTxnHash` varchar(16) DEFAULT NULL,
  `extTxnId` varchar(36) DEFAULT NULL,
  `extTxnLineId` varchar(36) DEFAULT NULL,
  `postSOId` int NOT NULL,
  `postedTotalCost` decimal(28,9) DEFAULT NULL,
  `qty` decimal(28,9) NOT NULL,
  `receiptItemId` int DEFAULT NULL,
  `shipItemId` int DEFAULT NULL,
  `soItemId` int NOT NULL,
  `totalPrice` decimal(28,9) DEFAULT NULL,
  `totalPriceMc` decimal(28,9) DEFAULT NULL,
  `totalTax` decimal(28,9) DEFAULT NULL,
  `totalTaxMc` decimal(28,9) DEFAULT NULL
);

CREATE TABLE `poststatus` (
  `id` int NOT NULL,
  `name` varchar(15) NOT NULL
);

CREATE TABLE `posttype` (
  `id` int NOT NULL,
  `name` varchar(30) NOT NULL
);

CREATE TABLE `postwo` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dateCreated` datetime(6) NOT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `datePosted` datetime(6) DEFAULT NULL,
  `extRefNumber` varchar(21) DEFAULT NULL,
  `extTxnHash` varchar(16) DEFAULT NULL,
  `extTxnId` varchar(36) DEFAULT NULL,
  `extTxnNumber` int DEFAULT NULL,
  `postDate` datetime(6) DEFAULT NULL,
  `statusId` int NOT NULL,
  `woId` int NOT NULL
);

CREATE TABLE `postwoitem` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dateCreated` datetime(6) NOT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `extRefNumber` varchar(21) DEFAULT NULL,
  `extTxnHash` varchar(16) DEFAULT NULL,
  `extTxnId` varchar(36) DEFAULT NULL,
  `extTxnLineId` varchar(36) DEFAULT NULL,
  `postWoId` int NOT NULL,
  `postedTotalCost` decimal(28,9) DEFAULT NULL,
  `woItemId` int DEFAULT NULL
);

CREATE TABLE `postxo` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dateCreated` datetime(6) NOT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `datePosted` datetime(6) DEFAULT NULL,
  `extRefNumber` varchar(21) DEFAULT NULL,
  `extTxnHash` varchar(16) DEFAULT NULL,
  `extTxnId` varchar(36) DEFAULT NULL,
  `extTxnNumber` int DEFAULT NULL,
  `postDate` datetime(6) DEFAULT NULL,
  `statusId` int NOT NULL,
  `xoId` int NOT NULL
);

CREATE TABLE `postxoitem` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dateCreated` datetime(6) NOT NULL,
  `dateLastModified` datetime(6) DEFAULT NULL,
  `extTxnLineId` varchar(36) DEFAULT NULL,
  `postXOId` int NOT NULL,
  `postedTotalCost` decimal(28,9) DEFAULT NULL,
  `qty` decimal(28,9) NOT NULL,
  `recordId` int DEFAULT NULL,
  `xoItemId` int DEFAULT NULL
);

CREATE TABLE `wallet` (
  `id` int NOT NULL AUTO_INCREMENT,
  `gatewayName` varchar(150) NOT NULL,
  `gatewayProfileId` varchar(255) NOT NULL,
  `customerId` int NOT NULL
);
