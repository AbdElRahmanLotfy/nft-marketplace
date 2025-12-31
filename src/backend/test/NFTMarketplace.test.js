const { ethers } = require("hardhat");
const { expect } = require("chai");

const toWei = (num) => ethers.parseEther(num.toString());
// const fromWei = (num) => ethers.formatEther(num);

describe("NFTMarketplace", () => {
  let deployer;
  let addr1;
  let addr2;
  let nft11;
  let marketplace;
  let feePercent = 1n;
  let URI = "Sample URI";

  beforeEach(async () => {
    const NFT11 = await ethers.getContractFactory("NFT11");
    const Marketplace = await ethers.getContractFactory("Marketplace");

    [deployer, addr1, addr2] = await ethers.getSigners();

    nft11 = await NFT11.deploy();
    marketplace = await Marketplace.deploy(feePercent);
  });

  describe("Deployment", () => {
    it("Should track name and symbol", async () => {
      const name = "NFT11";
      const symbol = "11th";
      expect(await nft11.name()).equal(name);
      expect(await nft11.symbol()).equal(symbol);
    });
    it("Should track feeAccount and feePercent of the marketplace", async () => {
      expect(await marketplace.feeAccount()).equal(deployer.address);
      expect(await marketplace.feePercent()).equal(feePercent);
    });
  });

  describe("Minting NFTs", () => {
    it("Should track each minted NFT", async () => {
      await nft11.connect(addr1).mint(URI);
      expect(await nft11.tokenCount()).equal(1n);
      expect(await nft11.balanceOf(addr1.address)).equal(1n);
      expect(await nft11.tokenURI(1)).equal(URI);

      await nft11.connect(addr2).mint(URI);
      expect(await nft11.tokenCount()).equal(2n);
      expect(await nft11.balanceOf(addr1.address)).equal(1n);
      expect(await nft11.tokenURI(2)).equal(URI);
    });
  });

  describe("Making marketplace items", () => {
    let price = 1;
    // let result;
    beforeEach(async () => {
      // Addr1 mints an NFT
      await nft11.connect(addr1).mint(URI);
      // Addr1 approves marketplace to spend NFT
      await nft11.connect(addr1).setApprovalForAll(marketplace.target, true);
    });
    it("Should track newly created item, transfer NFT from seller to marketplace and emit Offered event", async function () {
      await expect(
        marketplace.connect(addr1).makeItem(nft11.target, 1, toWei(price))
      )
        .emit(marketplace, "Offered")
        .withArgs(1, nft11.target, 1, toWei(price), addr1.address);

      // Owner of NFT should now be the marketplace
      expect(await nft11.ownerOf(1)).equal(marketplace.target);

      // Item count should now equal 1
      expect(await marketplace.itemCount()).equal(1);

      // Check stored item
      const item = await marketplace.items(1);
      expect(item.itemId).equal(1);
      expect(item.nft).equal(nft11.target);
      expect(item.tokenId).equal(1);
      expect(item.price).equal(toWei(price));
      expect(item.sold).equal(false);
    });

    it("Should fail if price is set to zero", async function () {
      await expect(
        marketplace.connect(addr1).makeItem(nft11.target, 1, 0)
      ).revertedWith("Price must be greater than zero");
    });
  });
  describe("Purchasing marketplace items", function () {
    let price = 2;
    let fee;
    let totalPriceInWei;

    beforeEach(async function () {
      // addr1 mints an nft
      await nft11.connect(addr1).mint(URI);

      // addr1 approves marketplace
      await nft11.connect(addr1).setApprovalForAll(marketplace.target, true);

      // addr1 lists nft
      await marketplace.connect(addr1).makeItem(nft11.target, 1, toWei(price));

      // calculate fee in wei (BigInt safe)
      fee = (toWei(price) * feePercent) / 100n;

      // fetch total price
      totalPriceInWei = await marketplace.getTotalPrice(1);
    });

    it("Should update item as sold, pay seller, transfer NFT to buyer, charge fees and emit a Bought event", async function () {
      const sellerInitialEthBal = await ethers.provider.getBalance(
        addr1.address
      );
      const feeAccountInitialEthBal = await ethers.provider.getBalance(
        deployer.address
      );

      await expect(
        marketplace.connect(addr2).purchaseItem(1, { value: totalPriceInWei })
      )
        .emit(marketplace, "Bought")
        .withArgs(
          1,
          nft11.target,
          1,
          toWei(price),
          addr1.address,
          addr2.address
        );

      const sellerFinalEthBal = await ethers.provider.getBalance(addr1.address);
      const feeAccountFinalEthBal = await ethers.provider.getBalance(
        deployer.address
      );

      // Item sold
      expect((await marketplace.items(1)).sold).equal(true);

      // Seller paid
      expect(sellerFinalEthBal - sellerInitialEthBal).equal(toWei(price));

      // Fee paid
      expect(feeAccountFinalEthBal - feeAccountInitialEthBal).equal(fee);

      // Buyer owns NFT
      expect(await nft11.ownerOf(1)).equal(addr2.address);
    });

    it("Should fail for invalid item ids, sold items and when not enough ether is paid", async function () {
      await expect(
        marketplace.connect(addr2).purchaseItem(2, { value: totalPriceInWei })
      ).revertedWith("item doesn't exist");

      await expect(
        marketplace.connect(addr2).purchaseItem(0, { value: totalPriceInWei })
      ).revertedWith("item doesn't exist");

      await expect(
        marketplace.connect(addr2).purchaseItem(1, { value: toWei(price) })
      ).revertedWith("not enough ether to cover item price and market fee");

      await marketplace
        .connect(addr2)
        .purchaseItem(1, { value: totalPriceInWei });

      const addr3 = (await ethers.getSigners())[3];

      await expect(
        marketplace.connect(addr3).purchaseItem(1, { value: totalPriceInWei })
      ).revertedWith("item already sold");
    });
  });
});
