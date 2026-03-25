import express from "express";
import { getStudentProfile } from "./dashboard.service.js";

const router = express.Router();

/**
 * Route: GET /profile/:studentId
 * Aggregates student records into a single profile.
 */
router.get("/profile/:studentId", async (req, res) => {
  const { studentId } = req.params;

  if (!studentId) {
    return res.status(400).json({ error: "No Student ID provided." });
  }

  try {
    const studentProfile = await getStudentProfile(studentId);
    return res.status(200).json({
      status: "success",
      data: studentProfile
    });
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: err.message
    });
  }
});

export default router;
