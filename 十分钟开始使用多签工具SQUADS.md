# 十分钟开始使用多签工具SQUADS


## 关于squads
Squads是Solana区块链上领先的多重签名(multisig)解决方案，已经为超过100亿美元的资产提供安全保障。它提供直观的用户界面和完善的安全机制，让团队能够安全地管理数字资产、程序升级权限和验证者节点。作为一个去中心化的自托管工具，Squads支持多种功能，包括资金库管理、代币发行、NFT操作以及与Solana生态系统中其他DeFi应用的集成。其核心特点是要求多方签名才能执行交易，大大提升了资产安全性，特别适合DAO组织和Web3项目团队使用。

## 什么是多重签名(multisig)

多重签名(Multisig)是一种数字资产安全管理机制，要求多个预设的密钥持有者共同授权才能执行某项操作。与传统的单一签名不同，多重签名通常设置为"M-of-N"模式，即在N个授权者中需要至少M个授权者同意才能完成交易。例如，在3-of-5的多重签名设置中，需要5个授权者中的至少3个同意才能执行交易。这种机制有效防止了单点故障，即使某个密钥丢失或被盗，资产仍然是安全的。

## 快速开始
接下来我们会有一个简单的教程展示如何使用Typescript在测试网上与SQUADS 协议交互。 

首先，创建目录和文件结构：
```
mkdir squads_quickstart
cd squads_quickstart
```

1. 创建 `tsconfig.json`:
```json:squads_quickstart/tsconfig.json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "es6",
    "esModuleInterop": true
  }
}
```


2. 创建 `package.json`:
```json:squads_quickstart/package.json
{
  "scripts": {
    "test": "npx mocha -r ts-node/register 'main.ts' --timeout 10000"
  },
  "dependencies": {
    "@solana/web3.js": "^1.73.0",
    "@sqds/multisig": "^2.1.3"
  },
  "devDependencies": {
    "@types/chai": "^4.3.3",
    "@types/mocha": "^10.0.6",
    "chai": "^4.3.6",
    "mocha": "^10.3.0",
    "ts-mocha": "^10.0.0",
    "typescript": "^4.8.3"
  }
}
```
3. 创建main.ts
本文将会带领读者创建一个脚本逐步进行如下几步，创建多签，提出一个新的转账，进行投票并且执行。
首先， 设置多签成员并且创建地址
~~~
describe("Interacting with the Squads V4 SDK", () => {
  const creator = Keypair.generate();
  const secondMember = Keypair.generate();
  before(async () => {
    const airdropSignature = await connection.requestAirdrop(
      creator.publicKey,
      1 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSignature);
  });

  const createKey = Keypair.generate();

  // 从多签账户中派生PDA
  const [multisigPda] = multisig.getMultisigPda({
    createKey: createKey.publicKey,
  });

  it("Create a new multisig", async () => {
    const programConfigPda = multisig.getProgramConfigPda({})[0];

    console.log("Program Config PDA: ", programConfigPda.toBase58());

    const programConfig =
      await multisig.accounts.ProgramConfig.fromAccountAddress(
        connection,
        programConfigPda
      );

    const configTreasury = programConfig.treasury;

    // 生成多签
    const signature = await multisig.rpc.multisigCreateV2({
      connection,
      //一次性密钥
      createKey,
      // 创建者和费用支付这
      creator,
      multisigPda,
      configAuthority: null,
      timeLock: 0,
      members: [
        {
          key: creator.publicKey,
          permissions: Permissions.all(),
        },
        {
          key: secondMember.publicKey,
          // 这里的权限代表用户只可以投票
          permissions: Permissions.fromPermissions([Permission.Vote]),
        },
      ],
      // 这里代表至少需要两票才可以使提案通过
      threshold: 2,
      rentCollector: null,
      treasury: configTreasury,
      sendOptions: { skipPreflight: true },
    });
    await connection.confirmTransaction(signature);
    console.log("Multisig created: ", signature);
  });
~~~

生成转账提案

现在，我们可以进行转账提案的生成。 我们希望这个多签账户向生成者发送0.1 SOL。

~~~
  it("Create a transaction proposal", async () => {
    const [vaultPda] = multisig.getVaultPda({
      multisigPda,
      index: 0,
    });
    const instruction = SystemProgram.transfer({
      // 转账是从Squads金库签名的，这就是为什么我们使用VaultPda
      fromPubkey: vaultPda,
      toPubkey: creator.publicKey,
      lamports: 1 * LAMPORTS_PER_SOL,
    });
    // 这个消息包含了交易将要执行的指令
    const transferMessage = new TransactionMessage({
      payerKey: vaultPda,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
      instructions: [instruction],
    });

    // 获取当前多签交易索引
    const multisigInfo = await multisig.accounts.Multisig.fromAccountAddress(
      connection,
      multisigPda
    );

    const currentTransactionIndex = Number(multisigInfo.transactionIndex);

    const newTransactionIndex = BigInt(currentTransactionIndex + 1);

    const signature1 = await multisig.rpc.vaultTransactionCreate({
      connection,
      feePayer: creator,
      multisigPda,
      transactionIndex: newTransactionIndex,
      creator: creator.publicKey,
      vaultIndex: 0,
      ephemeralSigners: 0,
      transactionMessage: transferMessage,
      memo: "Transfer 0.1 SOL to creator",
    });

    await connection.confirmTransaction(signature1);

    console.log("Transaction created: ", signature1);

    const signature2 = await multisig.rpc.proposalCreate({
      connection,
      feePayer: creator,
      multisigPda,
      transactionIndex: newTransactionIndex,
      creator,
    });

    await connection.confirmTransaction(signature2);

    console.log("Transaction proposal created: ", signature2);
  });
~~~
向提案投票，这里我们使用教程开始部分生成的两个密钥
~~~
  it("Vote on the created proposal", async () => {
    // 获取当前多签账户的交易索引
    const transactionIndex =
      await multisig.accounts.Multisig.fromAccountAddress(
        connection,
        multisigPda
      ).then((info) => Number(info.transactionIndex));

    // 第一个成员（创建者）对提案进行投票
    const signature1 = await multisig.rpc.proposalApprove({
      connection,
      feePayer: creator,      // 交易费用支付者
      multisigPda,            // 多签账户地址
      transactionIndex: BigInt(transactionIndex),  // 交易索引
      member: creator,        // 投票成员
    });

    // 等待第一个投票交易确认
    await connection.confirmTransaction(signature1);

    // 第二个成员对提案进行投票
    const signature2 = await multisig.rpc.proposalApprove({
      connection,
      feePayer: creator,      // 交易费用仍由创建者支付
      multisigPda,            // 多签账户地址
      transactionIndex: BigInt(transactionIndex),  // 交易索引
      member: secondMember,   // 第二个投票成员
    });

    // 等待第二个投票交易确认
    await connection.confirmTransaction(signature2);
  });
~~~
执行交易

~~~
  it("Execute the proposal", async () => {
    const transactionIndex =
      await multisig.accounts.Multisig.fromAccountAddress(
        connection,
        multisigPda
      ).then((info) => Number(info.transactionIndex));

    const [proposalPda] = multisig.getProposalPda({
      multisigPda,
      transactionIndex: BigInt(transactionIndex),
    });
    const signature = await multisig.rpc.vaultTransactionExecute({
      connection,
      feePayer: creator,
      multisigPda,
      transactionIndex: BigInt(transactionIndex),
      member: creator.publicKey,
      signers: [creator],
      sendOptions: { skipPreflight: true },
    });

    await connection.confirmTransaction(signature);
    console.log("Transaction executed: ", signature);
  });

});
~~~
###
最后，使用
~~~
yarn test
~~~
来执行脚本

好了,现在脚本已经执行完成，复制地址可以在[solana explorer](https://explorer.solana.com/?cluster=custom)中查看。

完整代码可以参考
https://github.com/kimmy1886/squads_quickstart