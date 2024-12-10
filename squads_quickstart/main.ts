import * as multisig from "@sqds/multisig";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionMessage,
  clusterApiUrl,
} from "@solana/web3.js";

const { Permission, Permissions } = multisig.types;

// 如果在本地运行有困难，请使用 'https://api.devnet.solana.com'
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

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

  // 派生多签账户PDA
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

    // 创建多签
    const signature = await multisig.rpc.multisigCreateV2({
      connection,
      createKey,
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
          permissions: Permissions.fromPermissions([Permission.Vote]),
        },
      ],
      threshold: 2,
      rentCollector: null,
      treasury: configTreasury,
      sendOptions: { skipPreflight: true },
    });
    await connection.confirmTransaction(signature);
    console.log("Multisig created: ", signature);
  });

  it("Create a transaction proposal", async () => {
    const [vaultPda] = multisig.getVaultPda({
      multisigPda,
      index: 0,
    });
    const instruction = SystemProgram.transfer({
      fromPubkey: vaultPda,
      toPubkey: creator.publicKey,
      lamports: 1 * LAMPORTS_PER_SOL,
    });
    const transferMessage = new TransactionMessage({
      payerKey: vaultPda,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
      instructions: [instruction],
    });

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

  it("Vote on the created proposal", async () => {
    const transactionIndex =
      await multisig.accounts.Multisig.fromAccountAddress(
        connection,
        multisigPda
      ).then((info) => Number(info.transactionIndex));

    const signature1 = await multisig.rpc.proposalApprove({
      connection,
      feePayer: creator,
      multisigPda,
      transactionIndex: BigInt(transactionIndex),
      member: creator,
    });

    await connection.confirmTransaction(signature1);

    const signature2 = await multisig.rpc.proposalApprove({
      connection,
      feePayer: creator,
      multisigPda,
      transactionIndex: BigInt(transactionIndex),
      member: secondMember,
    });

    await connection.confirmTransaction(signature2);
  });

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