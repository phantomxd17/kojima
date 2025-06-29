const port = process.env.PORT || 4000;
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const admin = require("./models/admin");
const path = require("path");
const db = admin.firestore();
const bucket = admin.storage().bucket();
const Storage = multer.memoryStorage();
const upload = multer({
  storage: Storage,
});
const { getAuth, signInWithEmailAndPassword } = require("firebase/auth");
const { initializeApp } = require("firebase/app");
const app = express();
app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
const firebaseConfig = {
  apiKey: "AIzaSyDqjF1AdgIUMcsgoc3_m6w1WRlH3BvwHOo",
  authDomain: "project5-1a5d6.firebaseapp.com",
  projectId: "project5-1a5d6",
  storageBucket: "project5-1a5d6.appspot.com",
  messagingSenderId: "42130624536",
  appId: "1:42130624536:web:ae0ab17e1f02176465736d",
  measurementId: "G-CT0QDEEH7J"
};
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);

async function getBuilds() {
  const buildsSnapshot = await db.collection("builds").get();
  const builds = [];
  buildsSnapshot.forEach((doc) => {
    builds.push({ id: doc.id, ...doc.data() });
  });
  return builds;
}

async function getBuildById(buildId) {
  const buildRef = db.collection("builds").doc(buildId);
  const doc = await buildRef.get();
  if (!doc.exists) {
    throw new Error("Build not found");
  }
  return doc.data();
}

// Upload function for files to Firebase Storage
const uploadFile = async (file, folderName) => {
  const fileName = `builds/${folderName}/${Date.now()}-${file.originalname}`;
  const fileUpload = bucket.file(fileName);
  const stream = fileUpload.createWriteStream({
    metadata: {
      contentType: file.mimetype,
    },
  });

  return new Promise((resolve, reject) => {
    stream.on("error", (error) => {
      reject(error);
    });

    stream.on("finish", () => {
      const url = `https://firebasestorage.googleapis.com/v0/b/${
        bucket.name
      }/o/${encodeURIComponent(fileName)}?alt=media`;
      resolve(url);
    });

    stream.end(file.buffer);
  });
};

// Middleware to verify ID token
const verifyIdToken = async (req, res, next) => {
  try {
    const idToken = req.query.id;
    await admin.auth().verifyIdToken(idToken);
    next();
  } catch (error) {
    console.error("Error verifying ID token:", error);
    res.redirect("/login?message=Access Denied Admin Only");
  }
};

app.get("/", async (req, res) => {
  const builds = await getBuilds();
  res.render("index", { builds: builds });
});

app.get("/builds", async (req, res) => {
  try {
    const buildId = req.query.build;
    const build = await getBuildById(buildId);
    res.render("builds", { build: build });
  } catch {
    res.render("index");
  }
});

app.get("/login", async (req, res) => {
  const message = req.query.message || null;
  res.render("login", { message: message });
});

app.get("/control", verifyIdToken, async (req, res) => {
  const message = req.query.message || null;
  const token = req.query.id;
  res.render("control", { message: message, token: token });
});

app.post("/login", upload.none(), async (req, res) => {
  const user = req.body;
  try {
    const userCredential = await signInWithEmailAndPassword(
      auth,
      user.email,
      user.password
    );
    const idTokenResult = await userCredential.user.getIdTokenResult();

    res.redirect(`/control?id=${idTokenResult.token}`);
  } catch (error) {
    res.redirect("/login?message=Wrong Email or password");
  }
});

app.get("/control/buildView", verifyIdToken, async (req, res) => {
  const builds = await getBuilds();
  const message = req.query.message || null;
  const token = req.query.id;
  res.render("controlView", { builds: builds, message: message, token: token });
});

app.get("/play", (req, res) => {
  const video = req.query.url;
  res.render("play", { video: video });
});

app.post(
  "/addBuild",
  upload.fields([{ name: "imageFile", maxCount: 1 }, { name: "filesUrl" }]),
  async (req, res) => {
    try {
      const {
        name,
        apartmentDetails,
        apartmentSize,
        location,
        numberOfApartment,
        token,
      } = req.body;
      const imageFile = req.files["imageFile"][0];
      const filesUrl = req.files["filesUrl"];

      // Upload image file
      const imageUrl = await uploadFile(imageFile, "photo");

      // Upload video/image files
      const listUrls = await Promise.all(
        filesUrl.map(async (file) => {
          const url = await uploadFile(file, `video/${name}`);
          return url;
        })
      );

      // Save build data to Firestore
      const newBuild = {
        name,
        apartmentDetails,
        apartmentSize,
        location,
        numberOfApartment,
        imageUrl,
        listUrls,
      };

      await db.collection("builds").add(newBuild);

      res.redirect(`/control?id=${token}&message=تم اضافة العقار بنجاح`);
    } catch (error) {
      console.error("Error adding build:", error);
      res.redirect(`/control?id=${token}&message=فشل في اضافة العقار`);
    }
  }
);

app.post(
  "/modifyBuild",
  upload.fields([{ name: "imageFile", maxCount: 1 }, { name: "filesUrl" }]),
  async (req, res) => {
    try {
      const {
        id,
        name,
        apartmentDetails,
        apartmentSize,
        location,
        numberOfApartment,
        token,
      } = req.body;

      const imageFile = req.files["imageFile"]
        ? req.files["imageFile"][0]
        : null;
      const filesUrl = req.files["filesUrl"] ? req.files["filesUrl"] : null;

      // Fetch existing build
      const buildRef = db.collection("builds").doc(id);
      const doc = await buildRef.get();

      if (!doc.exists) {
        throw new Error("Build not found");
      }

      const updateData = {
        name,
        apartmentDetails,
        apartmentSize,
        location,
        numberOfApartment,
      };

      if (imageFile) {
        const imageUrl = await uploadFile(imageFile, "photo");
        updateData.imageUrl = imageUrl;
      }

      if (filesUrl) {
        const existingUrls = doc.data().listUrls || [];
        const newUrls = await Promise.all(
          filesUrl.map(async (file) => {
            const url = await uploadFile(file, `video/${name}`);
            return url;
          })
        );
        updateData.listUrls = existingUrls.concat(newUrls);
      }

      // Update build data in Firestore
      await buildRef.update(updateData);

      res.redirect(
        `/control/buildView?id=${token}&message=تم تعديل العقار بنجاح`
      );
    } catch (error) {
      console.error("Error modifying build:", error);
      res.redirect(
        `/control/buildView?id=${token}&message=فشل في تعديل العقار`
      );
    }
  }
);

app.post("/deleteBuild", upload.none(), async (req, res) => {
  try {
    const { delID,token } = req.body;

    // Retrieve the course document to get the URLs
    const buildsDoc = await db.collection("builds").doc(delID).get();
    const buildData = buildsDoc.data();

    // Helper function to delete a file from Firebase Storage
    const deleteFile = async (fileUrl) => {
      if (fileUrl) {
        const decodedUrl = decodeURIComponent(fileUrl);
        console.log(`Attempting to delete file at URL: ${decodedUrl}`);

        // Extract the file path from the URL
        const filePath = decodedUrl.split("/o/")[1].split("?alt=media")[0];
        console.log(`Extracted file path: ${filePath}`);

        try {
          // Check if file exists before attempting to delete
          const [exists] = await bucket.file(filePath).exists();
          if (exists) {
            await bucket.file(filePath).delete();
            console.log(`File deleted successfully: ${filePath}`);
          } else {
            console.log(`File does not exist: ${filePath}`);
          }
        } catch (error) {
          console.error(`Error deleting file ${filePath}:`, error);
        }
      }
    };

    // Delete associated files
    await Promise.all([
      deleteFile(buildData.imageUrl),
      deleteFile(buildData.listUrls),
      ...(buildData.listUrls || []).map(async (url) => {
        await deleteFile(url);
      }),
    ]);

    // Delete the build from Firestore
    await db.collection("builds").doc(delID).delete();

    res.redirect(`/control/buildView?id=${token}&message=تم مسح العقار بنجاح`);
  } catch (error) {
    console.error("Error deleting build:", error);
    res.redirect(`/control/buildView?id=${token}&message=فشل في مسح العقار`);
  }
});

app.post("/modifyMedia", upload.single("newMediaFile"), async (req, res) => {
  try {
    const { mediaUrl, modMeddiaId,token } = req.body;
    const newMediaFile = req.file;

    const decodedUrl = decodeURIComponent(mediaUrl);

    // Extract the file path from the URL
    const filePath = decodedUrl.split("/o/")[1].split("?alt=media")[0];

    // Extract the folder name
    const folderName = filePath.split("/")[2];

    // Delete the old file from Firebase Storage
    await bucket.file(filePath).delete();

    // Upload new media file
    const newMediaUrl = await uploadFile(newMediaFile, `video/${folderName}`);

    // Fetch the specific build document
    const buildDocRef = db.collection("builds").doc(modMeddiaId);
    const buildDoc = await buildDocRef.get();

    // Update the listUrls field
    const build = buildDoc.data();
    if (build.listUrls.includes(mediaUrl)) {
      const updatedUrls = build.listUrls.map((url) =>
        url === mediaUrl ? newMediaUrl : url
      );
      await buildDocRef.update({ listUrls: updatedUrls });
    }

    res.redirect(`/control/buildView?id=${token}&message=تم تعديل الملف بنجاح`);
  } catch (error) {
    console.error("Error modifying media:", error);
    res.redirect(`/control/buildView?id=${token}&message=فشل في تعديل الملف`);
  }
});

app.post("/deleteMedia", upload.none(), async (req, res) => {
  try {
    const { delMediaUrl, delMeddiaId,token } = req.body;

    const decodedUrl = decodeURIComponent(delMediaUrl);

    // Extract the file path from the URL
    const filePath = decodedUrl.split("/o/")[1].split("?alt=media")[0];

    // Delete the old file from Firebase Storage
    await bucket.file(filePath).delete();

    // Fetch the specific build document using delMediaId
    const buildDocRef = db.collection("builds").doc(delMeddiaId);
    const buildDoc = await buildDocRef.get();

    // Update the listUrls field by removing the deleted media URL
    const build = buildDoc.data();
    if (build.listUrls.includes(delMediaUrl)) {
      const updatedUrls = build.listUrls.filter((url) => url !== delMediaUrl);
      await buildDocRef.update({ listUrls: updatedUrls });
    }

    res.redirect(`/control/buildView?id=${token}&message=تم مسح الملف بنجاح`);
  } catch (error) {
    console.error("Error deleting media:", error);
    res.redirect(`/control/buildView?id=${token}&message=فشل في مسح الملف`);
  }
});

app.listen(port, () => {
  console.log(`http://localhost:${port}/`);
});
